// Emails the coaches when a pitcher sends a message or uploads a video.
// Run every few minutes by .github/workflows/notify-coaches.yml (or by hand):
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SMTP_USER=... SMTP_PASS=... NOTIFY_TO="a@x.com,b@y.com" \
//     node tools/notify_coaches.mjs [--test]
//
//   SMTP_HOST   mail server (default smtp.gmail.com)          SMTP_PORT  465 = TLS (default), 587 = STARTTLS
//   NOTIFY_FROM sender address (default SMTP_USER)            APP_URL    link base (default the GitHub Pages app)
//   --test      send one test email and touch nothing in the database
//
// Each message or video is emailed once: its notified_at is stamped after the mail server accepts the email.
// Rows older than STALE_HOURS that were never notified (everything from before this was switched on) are stamped
// without an email, so the first run does not replay history. One email per run, grouped by pitcher.
import fs from 'node:fs';
import vm from 'node:vm';
import net from 'node:net';
import tls from 'node:tls';

const clean = s => String(s || '').trim().replace(/^["'`]+|["'`]+$/g, '');
// A key pasted with a line break in it (long values wrap) is rejected as an HTTP header value: drop all inner whitespace.
const URL_ = clean(process.env.SUPABASE_URL).replace(/\s+/g, '').replace(/\/+$/, '');
const KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY).replace(/\s+/g, '');
// Sending mailboxes, tried in order: SMTP_* first, then SMTP_*_2 if the first one fails (expired app password, outage).
function account(sfx) {
  const user = clean(process.env['SMTP_USER' + sfx]);
  const host = clean(process.env['SMTP_HOST' + sfx]) || (/@(icloud|me|mac)\.com$/i.test(user) ? 'smtp.mail.me.com' : 'smtp.gmail.com');
  return {
    host,
    port: Number(clean(process.env['SMTP_PORT' + sfx])) || (host === 'smtp.mail.me.com' ? 587 : 465),
    user,
    pass: String(process.env['SMTP_PASS' + sfx] || '').trim(),
    from: clean(process.env['NOTIFY_FROM' + sfx]) || user
  };
}
const ACCOUNTS = [account(''), account('_2')].filter(a => a.user && a.pass);
const SMTP = ACCOUNTS[0] || {};
const FROM = SMTP.from;
const TO = String(process.env.NOTIFY_TO || '').split(/[,;\s]+/).map(clean).filter(s => s.includes('@'));
const APP_URL = (clean(process.env.APP_URL) || 'https://sicher19-dev.github.io/No-Brand-Baseball-App/').replace(/\/?$/, '/');
const TEST = process.argv.includes('--test');
const STALE_HOURS = 48;

if (!ACCOUNTS.length || !TO.length) { console.error('SMTP_USER, SMTP_PASS and NOTIFY_TO are required.'); process.exit(1); }
if (!TEST && (!URL_ || !KEY)) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); process.exit(1); }

// ---------- roster (for names) ----------
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../www/roster.js', import.meta.url), 'utf8'), ctx);
const roster = ctx.window.NBB_ROSTER || { pitchers: [] };
const nameOf = id => { const p = roster.pitchers.find(x => x.id === id); return p ? `${p.first} ${p.last}` : id; };

// ---------- supabase REST ----------
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
async function api(path, opt = {}) {
  const r = await fetch(URL_ + path, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
  const t = await r.text();
  if (!r.ok) {
    if (/notified_at|uploaded_by_role/.test(t)) throw new Error(`${path} -> ${r.status} ${t}\nThe database is missing a column: re-run supabase/schema.sql in the Supabase SQL editor.`);
    throw new Error(`${opt.method || 'GET'} ${path} -> ${r.status} ${t}`);
  }
  return t ? JSON.parse(t) : null;
}
async function stamp(table, ids) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await api(`/rest/v1/${table}?id=in.(${chunk.join(',')})`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ notified_at: new Date().toISOString() })
    });
  }
}

// ---------- email ----------
const CT = { 'America/Chicago': 1 };
function when(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
}
function mb(b) { return b ? (Math.round(b / 104857.6) / 10) + ' MB' : ''; }
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function compose(groups) {
  // groups: [{ id, name, msgs: [...], vids: [...] }]
  const nMsg = groups.reduce((n, g) => n + g.msgs.length, 0);
  const nVid = groups.reduce((n, g) => n + g.vids.length, 0);
  const parts = [];
  if (nMsg) parts.push(`${nMsg} new message${nMsg > 1 ? 's' : ''}`);
  if (nVid) parts.push(`${nVid} new video${nVid > 1 ? 's' : ''}`);
  const subject = groups.length === 1
    ? `${groups[0].name}: ${parts.join(', ')}`
    : `No Brand Baseball: ${parts.join(', ')} from ${groups.length} pitchers`;

  const text = [], html = [];
  html.push('<div style="font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:600px">');
  for (const g of groups) {
    const link = `${APP_URL}#/coach/${encodeURIComponent(g.id)}`;
    text.push(`${g.name}`, '-'.repeat(g.name.length));
    html.push(`<h3 style="margin:18px 0 6px"><a href="${link}" style="color:#111">${escHtml(g.name)}</a></h3>`);
    for (const m of g.msgs) {
      text.push(`Message, ${when(m.created_at)}:`, `  ${m.body}`, '');
      html.push(`<p style="margin:6px 0"><b>Message</b> <span style="color:#666">${when(m.created_at)}</span><br>${escHtml(m.body).replace(/\n/g, '<br>')}</p>`);
    }
    for (const v of g.vids) {
      const note = v.note ? ` "${v.note}"` : '';
      text.push(`Video, ${when(v.created_at)} (${mb(v.size_bytes)})${note}`, '');
      html.push(`<p style="margin:6px 0"><b>Video</b> <span style="color:#666">${when(v.created_at)} · ${mb(v.size_bytes)}</span>${v.note ? '<br>' + escHtml(v.note) : ''}</p>`);
    }
    text.push(`Open in the app: ${link}`, '');
    html.push(`<p style="margin:6px 0 14px"><a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">Open ${escHtml(g.name.split(' ')[0])} in the app</a></p>`);
  }
  text.push('Sign in as a coach to reply or review. This alert is sent by the No Brand Baseball app.');
  html.push('<p style="color:#666;font-size:13px">Sign in as a coach to reply or review. This alert is sent by the No Brand Baseball app.</p></div>');
  return { subject, text: text.join('\n'), html: html.join('\n') };
}

function b64wrap(s) { return Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'); }
function buildMime({ subject, text, html, from }) {
  const boundary = 'nbb-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const id = `<${Date.now()}.${Math.random().toString(36).slice(2)}@nobrandbaseball.app>`;
  return [
    `From: No Brand Baseball <${from || FROM}>`,
    `To: ${TO.join(', ')}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64wrap(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64wrap(html),
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

// Minimal SMTP client: implicit TLS on 465, STARTTLS otherwise, AUTH PLAIN.
async function sendMail(message) {
  let lastErr;
  for (const acct of ACCOUNTS) {
    try { await sendVia(acct, buildMime({ ...message, from: acct.from })); return acct; }
    catch (e) { lastErr = e; console.warn(`Could not send through ${acct.host} as ${acct.user.replace(/^(.).*(@.*)$/, '$1***$2')}: ${e.message}`); }
  }
  throw lastErr || new Error('No sending mailbox configured.');
}
async function sendVia(SMTP, mime) {
  const FROM = SMTP.from;
  let sock = SMTP.port === 465
    ? tls.connect({ host: SMTP.host, port: SMTP.port, servername: net.isIP(SMTP.host) ? undefined : SMTP.host })
    : net.connect({ host: SMTP.host, port: SMTP.port });
  let buf = '';
  let waiter = null;
  const feed = d => { buf += d.toString('utf8'); if (waiter) waiter(); };
  const attach = s => { s.setEncoding('utf8'); s.on('data', feed); s.on('error', e => { if (waiter) waiter(e); }); };
  attach(sock);
  async function reply() {
    for (;;) {
      const lines = buf.split('\r\n');
      const done = lines.findIndex(l => /^\d{3}(?: |$)/.test(l));
      if (done >= 0) {
        const out = lines.slice(0, done + 1).join('\r\n');
        buf = lines.slice(done + 1).join('\r\n');
        return out;
      }
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('SMTP timeout')), 30000);
        waiter = e => { clearTimeout(t); waiter = null; e ? rej(e) : res(); };
      });
    }
  }
  async function cmd(line, expect, secret) {
    if (line !== null) sock.write(line + '\r\n');
    const r = await reply();
    if (!expect.test(r)) throw new Error(`SMTP ${secret ? '(auth)' : line.split(' ')[0]} failed: ${r.split('\r\n').pop()}`);
    return r;
  }
  await new Promise((res, rej) => { sock.once(SMTP.port === 465 ? 'secureConnect' : 'connect', res); sock.once('error', rej); });
  await cmd(null, /^220/);
  await cmd('EHLO nobrandbaseball.app', /^250/);
  if (SMTP.port !== 465) {
    await cmd('STARTTLS', /^220/);
    sock.removeAllListeners('data');
    sock = tls.connect({ socket: sock, servername: SMTP.host });
    attach(sock);
    await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
    await cmd('EHLO nobrandbaseball.app', /^250/);
  }
  await cmd('AUTH PLAIN ' + Buffer.from(`\0${SMTP.user}\0${SMTP.pass}`).toString('base64'), /^235/, true);
  await cmd(`MAIL FROM:<${FROM}>`, /^250/);
  for (const t of TO) await cmd(`RCPT TO:<${t}>`, /^25[01]/);
  await cmd('DATA', /^354/);
  await cmd(mime.replace(/\r?\n\./g, '\r\n..') + '\r\n.', /^250/);
  try { await cmd('QUIT', /^221/); } catch {}
  sock.end();
}

// ---------- main ----------
if (TEST) {
  const used = await sendMail({
    subject: 'No Brand Baseball: coach alerts are working',
    text: `This is a test from the No Brand Baseball app. Coaches will be emailed here when a pitcher sends a message or a video.\n\nCoach view: ${APP_URL}#/coach`,
    html: `<p style="font:15px -apple-system,Segoe UI,Helvetica,Arial,sans-serif">This is a test from the No Brand Baseball app. Coaches will be emailed here when a pitcher sends a message or a video.</p><p><a href="${APP_URL}#/coach">Open the coach view</a></p>`
  });
  console.log(`Test email sent to ${TO.length} address${TO.length > 1 ? 'es' : ''} via ${used.host}.`);
  process.exit(0);
}

const cutoff = new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString();
const msgs = await api('/rest/v1/messages?select=id,pitcher_id,body,created_at&sender_role=eq.pitcher&notified_at=is.null&order=created_at.asc&limit=300');
const vids = await api('/rest/v1/assessments?select=id,pitcher_id,note,size_bytes,created_at&uploaded_by_role=eq.pitcher&notified_at=is.null&order=created_at.asc&limit=300');

const staleM = msgs.filter(m => m.created_at < cutoff), staleV = vids.filter(v => v.created_at < cutoff);
const freshM = msgs.filter(m => m.created_at >= cutoff), freshV = vids.filter(v => v.created_at >= cutoff);
if (staleM.length || staleV.length) {
  await stamp('messages', staleM.map(m => m.id));
  await stamp('assessments', staleV.map(v => v.id));
  console.log(`Skipped ${staleM.length} message(s) and ${staleV.length} video(s) older than ${STALE_HOURS} h (marked, not emailed).`);
}
if (!freshM.length && !freshV.length) { console.log('Nothing new.'); process.exit(0); }

const byId = new Map();
const group = id => { if (!byId.has(id)) byId.set(id, { id, name: nameOf(id), msgs: [], vids: [] }); return byId.get(id); };
for (const m of freshM) group(m.pitcher_id).msgs.push(m);
for (const v of freshV) group(v.pitcher_id).vids.push(v);
const groups = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

const mail = compose(groups);
const via = await sendMail(mail);
await stamp('messages', freshM.map(m => m.id));
await stamp('assessments', freshV.map(v => v.id));
console.log(`Emailed ${TO.length} coach address${TO.length > 1 ? 'es' : ''} via ${via.host}: ${mail.subject}`);
