// Creates (or refreshes) the Supabase login for every pitcher in www/roster.js, and marks coach accounts.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node tools/provision_users.mjs [--reset-passwords]
//   COACH_EMAILS="a@x.com,b@y.com"   coaches: invited by email if missing, then given the coach role
//
// Idempotent: existing users are left alone unless --reset-passwords is passed (then their derived
// password and metadata are rewritten, e.g. after a name fix in the roster).
import fs from 'node:fs';
import vm from 'node:vm';

// Secrets pasted into GitHub sometimes carry a trailing newline, quotes or spaces; strip them.
const clean = s => String(s || '').replace(/[\s"'`]/g, '');
const URL_ = clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
const KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const COACHES = (process.env.COACH_EMAILS || '').split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
const RESET = process.argv.includes('--reset-passwords');
const RESEND = process.argv.includes('--resend-coach-links'); // email a fresh set-password link to coaches who never signed in

if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); process.exit(1); }

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../www/roster.js', import.meta.url), 'utf8'), ctx);
const roster = ctx.window.NBB_ROSTER;

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
async function api(path, opt = {}) {
  const r = await fetch(URL_ + path, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${opt.method || 'GET'} ${path} -> ${r.status} ${typeof j === 'string' ? j : JSON.stringify(j)}`);
  return j;
}
async function allUsers() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const j = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = j.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}
function creds(p) {
  const first = String(p.first || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return { email: `${p.id}@pitchers.nobrandbaseball.app`, password: `nbb-${p.id}-${first}` };
}
async function upsertProfile(row) {
  await api('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row)
  });
}

const users = await allUsers();
const byEmail = new Map(users.map(u => [String(u.email || '').toLowerCase(), u]));
let created = 0, reset = 0, kept = 0;

for (const p of roster.pitchers) {
  const c = creds(p);
  const meta = { pitcher_id: p.id, display_name: `${p.first} ${p.last}`, role: 'pitcher' };
  let u = byEmail.get(c.email);
  if (!u) {
    u = await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: c.email, password: c.password, email_confirm: true, user_metadata: meta }) });
    created++; console.log(`created   ${p.first} ${p.last}`);
  } else if (RESET) {
    await api(`/auth/v1/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ password: c.password, user_metadata: meta }) });
    reset++; console.log(`reset     ${p.first} ${p.last}`);
  } else {
    kept++;
  }
  await upsertProfile({ user_id: u.id, pitcher_id: p.id, role: 'pitcher', display_name: meta.display_name });
}

let coachesDone = 0;
for (const email of COACHES) {
  let u = byEmail.get(email);
  if (!u) {
    u = await api('/auth/v1/invite', { method: 'POST', body: JSON.stringify({ email, data: { role: 'coach', display_name: email } }) });
    console.log(`invited   ${email} (they get an email to set a password)`);
  } else if (RESEND && !u.last_sign_in_at) {
    await api('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email }) });
    console.log(`re-sent   set-password link to ${email}`);
  }
  await upsertProfile({ user_id: u.id, pitcher_id: null, role: 'coach', display_name: u.user_metadata?.display_name || email });
  coachesDone++;
}

console.log(`\nPitchers: ${created} created, ${reset} reset, ${kept} unchanged (${roster.pitchers.length} in roster). Coaches: ${coachesDone}.`);
