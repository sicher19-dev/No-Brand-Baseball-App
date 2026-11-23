// Builds the No Brand Baseball website into _site/: the site at the root, the pitcher app (www/) at /app/.
//   node tools/site/build.mjs            preview build (pages carry noindex)
//   node tools/site/build.mjs --live     launch build (indexable); set SITE_URL=https://www.example.com for share tags
// Every page is flat at the root and every link is relative, so the folder works at a domain root or under any sub-path.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'site');
const OUT = join(ROOT, '_site');
const LIVE = process.argv.includes('--live');
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const YEAR = new Date().getFullYear();

const NAV = [
  ['services', 'Services', './services.html'],
  ['tip', 'Tip Detection', './tip-detection.html'],
  ['about', 'About', './about.html'],
  ['contact', 'Contact', './contact.html'],
];
const DOORS = [
  ['Athlete log in', './app/'],
  ['Coach log in', './app/#/coach'],
  ['Team log in', './login.html#team'],
  ['Pitch Tip Tool', './login.html#tip-tool'],
];

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='15' fill='%23f5b700'/%3E%3Cpath fill='%230b0b0d' d='M10 44V20h7.2l8.6 12.9V20H32v24h-6.6l-9.2-13.6V44z'/%3E%3Cpath fill='%230b0b0d' fill-rule='evenodd' d='M34.5 44V20h10.9c5 0 8 2.4 8 6.3 0 2.4-1.2 4.2-3.2 5.1 2.7.8 4.3 2.9 4.3 5.7 0 4.3-3.3 6.9-8.6 6.9zm6.4-14.4h3.4c1.7 0 2.7-.8 2.7-2.2s-1-2.1-2.7-2.1h-3.4zm0 9.2h4c1.9 0 3-.9 3-2.4s-1.1-2.4-3-2.4h-4z'/%3E%3C/svg%3E";
const SYMBOLS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="nb" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#f5b700"/><path fill="#0b0b0d" d="M10 44V20h7.2l8.6 12.9V20H32v24h-6.6l-9.2-13.6V44z"/><path fill="#0b0b0d" fill-rule="evenodd" d="M34.5 44V20h10.9c5 0 8 2.4 8 6.3 0 2.4-1.2 4.2-3.2 5.1 2.7.8 4.3 2.9 4.3 5.7 0 4.3-3.3 6.9-8.6 6.9zm6.4-14.4h3.4c1.7 0 2.7-.8 2.7-2.2s-1-2.1-2.7-2.1h-3.4zm0 9.2h4c1.9 0 3-.9 3-2.4s-1.1-2.4-3-2.4h-4z"/></symbol>
  <symbol id="arr" viewBox="0 0 16 16"><path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="chev" viewBox="0 0 12 12"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
</svg>`;
const ARR = (n = 16) => `<svg width="${n}" height="${n}" aria-hidden="true"><use href="#arr"/></svg>`;
const BRAND = `<a class="brand" href="./" aria-label="No Brand Baseball Analytics, home"><svg aria-hidden="true"><use href="#nb"/></svg><span>No Brand</span><small>Baseball Analytics</small></a>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function layout(page, body) {
  const home = page.id === 'home';
  const cur = (id) => (id === page.nav ? ' aria-current="page"' : '');
  const title = home ? 'No Brand Baseball Analytics' : `${page.title} | No Brand Baseball Analytics`;
  const share = SITE_URL ? `
<link rel="canonical" href="${SITE_URL}/${home ? '' : page.file}">
<meta property="og:url" content="${SITE_URL}/${home ? '' : page.file}">
<meta property="og:image" content="${SITE_URL}/media/hero-delivery.jpg">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.desc)}">${LIVE && !page.noindex ? '' : '\n<meta name="robots" content="noindex">'}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(page.desc)}">
<meta property="og:type" content="website">${share}
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<link rel="icon" href="${ICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="./css/site.css">
<link rel="stylesheet" href="./css/${home ? 'home' : 'inner'}.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${SYMBOLS}
<div class="grain" aria-hidden="true"></div>

<header class="nav">
  ${BRAND}
  <nav class="nav__links" aria-label="Main">
${NAV.map(([id, label, href]) => `    <a href="${href}"${cur(id)}>${label}</a>`).join('\n')}
  </nav>
  <div class="nav__login">
    <button type="button" class="nav__lb" id="loginBtn" aria-expanded="false" aria-controls="loginMenu">Log in <svg width="12" height="12" aria-hidden="true"><use href="#chev"/></svg></button>
    <ul class="nav__menu" id="loginMenu" hidden>
${DOORS.map(([label, href]) => `      <li><a href="${href}">${label} ${ARR()}</a></li>`).join('\n')}
    </ul>
  </div>
  <a class="pill pill--sm" href="./contact.html">Work with us <i aria-hidden="true">${ARR(14)}</i></a>
  <button type="button" class="nav__burger" id="menuBtn" aria-expanded="false" aria-controls="sheet">Menu</button>
</header>

<div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="Menu" hidden>
  <div class="sheet__top">
    ${BRAND}
    <button type="button" class="nav__burger" id="sheetClose">Close</button>
  </div>
  <nav class="sheet__nav" aria-label="Main, full screen">
${NAV.map(([, label, href], i) => `    <a href="${href}"><span>0${i + 1}</span>${label}</a>`).join('\n')}
  </nav>
  <nav class="sheet__log" aria-label="Log in">
${DOORS.map(([label, href]) => `    <a href="${href}">${label}</a>`).join('\n')}
  </nav>
  <a class="pill" href="./contact.html">Work with us <i aria-hidden="true">${ARR()}</i></a>
</div>

<main id="main">
${body.trim()}
</main>

<footer class="ft">
  <div class="ft__grid">
    <div>
      ${BRAND}
      <p class="ft__tag">Pitching analytics and coaching for arms that pitch for a living.</p>
    </div>
    <nav aria-label="Footer">
      <h2>Site</h2>
      <ul>
${NAV.map(([, label, href]) => `        <li><a href="${href}">${label}</a></li>`).join('\n')}
      </ul>
    </nav>
    <nav aria-label="Log in, footer">
      <h2>Log in</h2>
      <ul>
${DOORS.map(([label, href]) => `        <li><a href="${href}">${label}</a></li>`).join('\n')}
      </ul>
    </nav>
  </div>
  <div class="ft__end">
    <span>&copy; ${YEAR} No Brand Baseball Analytics</span>
    <a href="./privacy.html">Privacy</a>
    <span aria-hidden="true">End of reel</span>
  </div>
  <p class="ft__mark" aria-hidden="true">No Brand</p>
</footer>

<script src="./js/${home ? 'home' : 'site'}.js"></script>
</body>
</html>
`;
}

// ---- build ----
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const d of ['css', 'js', 'media']) cpSync(join(SRC, d), join(OUT, d), { recursive: true });
// the pitcher app, unchanged, at /app/ (the old preview page stays out of it)
cpSync(join(ROOT, 'www'), join(OUT, 'app'), { recursive: true, filter: (p) => !p.replace(/\\/g, '/').includes('/www/preview') });

const pages = [];
for (const f of readdirSync(join(SRC, 'pages')).filter((x) => x.endsWith('.html'))) {
  const raw = readFileSync(join(SRC, 'pages', f), 'utf8');
  const m = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) throw new Error(`${f}: first line must be <!-- {"title": ..., "desc": ...} -->`);
  const page = { id: f.replace('.html', ''), ...JSON.parse(m[1]) };
  page.file = page.id === 'home' ? 'index.html' : f;
  writeFileSync(join(OUT, page.file), layout(page, raw.slice(m[0].length)));
  pages.push(page);
}

// ---- checks: every local link and file reference resolves; nothing a visitor should not see ----
const problems = [], todo = [];
const BANNED = /trackman|rapsodo|statcast|savant|hawk-?eye|kinatrax|sporty|play[_ ]?id/i;
for (const page of pages) {
  const html = readFileSync(join(OUT, page.file), 'utf8');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));
  for (const [, ref] of html.matchAll(/\s(?:href|src|poster)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:)/.test(ref)) continue;
    const [path, hash] = ref.split('#');
    if (!path) { if (hash && !ids.has(hash)) problems.push(`${page.file}: #${hash} has no target`); continue; }
    let target = join(OUT, path);
    if (path.endsWith('/')) target = join(target, 'index.html');
    if (!existsSync(target)) { problems.push(`${page.file}: ${ref} does not exist`); continue; }
    if (hash && !hash.startsWith('/') && target.endsWith('.html') && !readFileSync(target, 'utf8').includes(` id="${hash}"`)) problems.push(`${page.file}: ${ref} has no target`);
  }
  const seen = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  const bad = seen.match(BANNED);
  if (bad) problems.push(`${page.file}: shows "${bad[0]}"`);
  for (const [, t] of html.matchAll(/data-placeholder>([^<]+)</g)) todo.push(`${page.file}: ${t}`);
}
console.log(`Built ${pages.length} pages into _site/ (${LIVE ? 'live' : 'preview, noindex'}), app at _site/app/`);
if (todo.length) console.log(`\nStill waiting on Brian (${todo.length}):\n  ` + todo.join('\n  '));
if (problems.length) { console.error(`\nProblems (${problems.length}):\n  ` + problems.join('\n  ')); process.exit(1); }
