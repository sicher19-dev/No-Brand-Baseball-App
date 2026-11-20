// Creates (or refreshes) the Supabase login for every pitcher in www/roster.js, and marks coach accounts.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node tools/provision_users.mjs [--reset-passwords]
//   COACH_EMAILS="a@x.com,b@y.com"   coaches: invited by email if missing, then given the coach role
//   COACH_LOGINS="user:password:Display Name" (one per line or ;-separated)
//                                     coaches who sign in with a username instead of an email. The account is
//                                     <user>@coaches.nobrandbaseball.app; the app maps the username to it.
//                                     Existing ones keep their password unless --reset-coach-passwords is passed.
//   PITCHER_LOGINS="pitcher_id:password" (one per line or ;-separated)
//                                     pitchers with their own password (roster entry has "auth": "password" and
//                                     usually a "username"). Applied on every run, so the secret is the source of truth.
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
const RESET_COACH = process.argv.includes('--reset-coach-passwords');
const COACH_LOGINS = String(process.env.COACH_LOGINS || '').split(/[;\r\n]+/).map(s => s.trim()).filter(Boolean).map(line => {
  const [user, password, ...rest] = line.split(':');
  const username = String(user || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return { username, password: String(password || '').trim(), name: rest.join(':').trim() || user.trim() };
}).filter(c => c.username && c.password);
const PITCHER_LOGINS = new Map(String(process.env.PITCHER_LOGINS || '').split(/[;\r\n]+/).map(s => s.trim()).filter(Boolean).map(line => {
  const i = line.indexOf(':');
  return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}).filter(([id, pw]) => id && pw));

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
  const own = p.auth === 'password' ? PITCHER_LOGINS.get(p.id) : undefined;   // own password only once the roster says so
  if (own) c.password = own;
  const meta = { pitcher_id: p.id, display_name: `${p.first} ${p.last}`, role: 'pitcher' };
  let u = byEmail.get(c.email);
  if (!u) {
    u = await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: c.email, password: c.password, email_confirm: true, user_metadata: meta }) });
    created++; console.log(`created   ${p.first} ${p.last}${own ? ' (own password)' : ''}`);
  } else if (RESET || own) {
    await api(`/auth/v1/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ password: c.password, user_metadata: meta }) });
    reset++; console.log(`reset     ${p.first} ${p.last}`);
  } else {
    kept++;
  }
  await upsertProfile({ user_id: u.id, pitcher_id: p.id, role: 'pitcher', display_name: meta.display_name });
}

// Workflow logs on a public repo are public: never print a full coach email.
const mask = e => e.replace(/^(.).*?(@.*)$/, '$1***$2');
let coachesDone = 0, rateLimited = 0;
for (const email of COACHES) {
  let u = byEmail.get(email);
  try {
    if (!u) {
      u = await api('/auth/v1/invite', { method: 'POST', body: JSON.stringify({ email, data: { role: 'coach', display_name: email } }) });
      console.log(`invited   ${mask(email)} (they get an email to set a password)`);
    } else if (RESEND && !u.last_sign_in_at) {
      await api('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email }) });
      console.log(`re-sent   set-password link to ${mask(email)}`);
    }
  } catch (e) {
    if (/429|rate limit/i.test(e.message)) {
      rateLimited++;
      console.log(`WAITING   ${mask(email)}: Supabase's built-in mailer allows 2 emails per hour. Re-run this workflow in an hour to send it.`);
      continue;
    }
    throw e;
  }
  await upsertProfile({ user_id: u.id, pitcher_id: null, role: 'coach', display_name: u.user_metadata?.display_name || email });
  coachesDone++;
}

// Username coaches: no email involved, so no mailer limit. Logs show only the first letter of the username.
let coachLogins = 0;
for (const c of COACH_LOGINS) {
  const email = `${c.username}@coaches.nobrandbaseball.app`;
  const meta = { role: 'coach', display_name: c.name, username: c.username };
  let u = byEmail.get(email);
  if (!u) {
    u = await api('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: c.password, email_confirm: true, user_metadata: meta }) });
    console.log(`created   coach login ${c.username[0]}*** (${c.name})`);
  } else if (RESET_COACH) {
    await api(`/auth/v1/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ password: c.password, user_metadata: meta }) });
    console.log(`reset     coach login ${c.username[0]}*** (${c.name})`);
  } else {
    console.log(`unchanged coach login ${c.username[0]}*** (${c.name})`);
  }
  await upsertProfile({ user_id: u.id, pitcher_id: null, role: 'coach', display_name: c.name });
  coachLogins++;
}

console.log(`\nPitchers: ${created} created, ${reset} reset, ${kept} unchanged (${roster.pitchers.length} in roster). Coaches: ${coachesDone} by email${rateLimited ? ` (${rateLimited} waiting on the email limit)` : ''}, ${coachLogins} by username.`);
