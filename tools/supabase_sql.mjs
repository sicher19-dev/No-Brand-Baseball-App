// Runs a .sql file against the Supabase project through the Management API (no psql, no dashboard).
//
//   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=xxxx node tools/supabase_sql.mjs supabase/schema.sql
//
// __PROJECT_REF__ and __PUSH_SECRET__ in the file are replaced from the environment (SUPABASE_PROJECT_REF, PUSH_SECRET).
import fs from 'node:fs';

const token = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const ref = String(process.env.SUPABASE_PROJECT_REF || '').trim();
const file = process.argv[2];
if (!token || !ref || !file) { console.error('Need SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF and a .sql file.'); process.exit(1); }

let sql = fs.readFileSync(file, 'utf8');
sql = sql.replace(/__PROJECT_REF__/g, ref).replace(/__PUSH_SECRET__/g, String(process.env.PUSH_SECRET || ''));
if (/__[A-Z_]+__/.test(sql)) { console.error('Unfilled placeholder in ' + file); process.exit(1); }

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
});
const text = await r.text();
if (!r.ok) { console.error(`${file}: ${r.status} ${text.slice(0, 2000)}`); process.exit(1); }
console.log(`${file}: applied (${sql.length} chars).`);
