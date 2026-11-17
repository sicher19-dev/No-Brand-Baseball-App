// Renders generic Google Play screenshots of the live app (no real pitcher data: the roster is swapped for
// "Sample Pitcher"), plus the 1024x500 feature graphic from feature.html.
// Play wants each screenshot's long side at most twice the short side, so these are 9:16 and 10:16 rather than
// the taller iPhone sizes in store/screenshots.
//
//   NODE_PATH=<folder with playwright installed>/node_modules node store/play/render.js
//
// Output: store/play/screenshots/phone-*.png (1080x1920), tablet7-*.png (1200x1920), tablet10-*.png (1600x2560),
//         store/play/feature-graphic.png (1024x500).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const base = 'https://sicher19-dev.github.io/No-Brand-Baseball-App/';
const out = path.join(__dirname, 'screenshots');
fs.mkdirSync(out, { recursive: true });

const ROSTER = {
  updated: '2026-11-17',
  pitchers: [{
    id: 'demo', first: 'Pitcher', last: 'Demo', org: 'Your Club', level: '', role: '', hand: 'RHP',
    reports: [
      { id: 'g-pen', kind: 'pen', title: 'Offseason Bullpen Plan', updated: '2026-11-10', url: 'about:blank' },
      { id: 'g-scout', kind: 'scout', title: 'In-Season Scouting Report', updated: '2026-09-21', url: 'about:blank' },
      { id: 'g-reverse', kind: 'reverse', title: 'Reverse Scouting Report', updated: '2026-09-26', url: 'about:blank' },
      { id: 'g-grades', kind: 'grades', title: 'Pitch Grades', updated: '2026-08-13', url: 'about:blank' },
      { id: 'g-exec', kind: 'execution', title: 'Execution Report', updated: '2026-08-02', url: 'about:blank' },
      { id: 'g-grips', kind: 'lab', title: 'Pitch Grip Library', updated: '2026-09-07', url: 'about:blank' }
    ]
  }]
};

const SIZES = {
  phone: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },   // 1080x1920
  tablet7: { viewport: { width: 600, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },  // 1200x1920
  tablet10: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } // 1600x2560
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });

  async function shot(size, name, hash, session, wait, after) {
    const ctx = await browser.newContext({ ...SIZES[size], locale: 'en-US' });
    await ctx.route('**/roster.js*', (route) => route.fulfill({
      status: 200, contentType: 'application/javascript',
      body: 'window.NBB_ROSTER = ' + JSON.stringify(ROSTER) + ';'
    }));
    await ctx.addInitScript((s) => {
      try { localStorage.clear(); if (s) localStorage.setItem('nbb.session', JSON.stringify(s)); } catch (e) {}
    }, session);
    const page = await ctx.newPage();
    await page.goto(base + hash, { waitUntil: 'load' });
    await page.waitForTimeout(wait || 2500);
    await page.evaluate(() => {
      var n = document.getElementById('player-name'); if (n) n.textContent = 'Sample Pitcher';
      // The demo account carries setup-test text; swap it for something a store visitor would expect.
      var swaps = {
        'Setup test message from the demo account': 'Pen went well today, slider felt sharp',
        'Just curious how fast you get the message when it is sent': 'Mobility video is up, let me know what you see',
        'Setup test clip (2 KB placeholder)': 'Mobility check-in'
      };
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var t; while ((t = w.nextNode())) { var k = t.nodeValue.trim(); if (swaps[k]) t.nodeValue = swaps[k]; }
    });
    if (after) await after(page);
    const file = path.join(out, size + '-' + name + '.png');
    await page.screenshot({ path: file });
    console.log('wrote', path.relative(process.cwd(), file));
    await ctx.close();
  }

  const sess = { kind: 'pitcher', id: 'demo', backend: true };
  for (const size of Object.keys(SIZES)) {
    await shot(size, '1-login', '#/login', null, 2500);
    await shot(size, '2-home', '#/home', sess, 6000);
    await shot(size, '3-reports', '#/home', sess, 6000, async (page) => {
      const el = await page.$('#report-groups');
      if (el) await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    });
    await shot(size, '4-assess', '#/home', sess, 6000, async (page) => {
      const el = await page.$('#assess-section');
      if (el) await page.evaluate((e) => e.scrollIntoView({ block: 'start' }), el);
      await page.waitForTimeout(500);
    });
  }

  // Feature graphic
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(__dirname, 'feature.html'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const fg = path.join(__dirname, 'feature-graphic.png');
  await page.screenshot({ path: fg });
  console.log('wrote', path.relative(process.cwd(), fg));
  await ctx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
