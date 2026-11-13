// Renders generic App Store screenshots of the live No Brand Baseball web app at iPhone 6.9" size (1290x2796).
// The roster is swapped for a single "Sample Pitcher" so no real client appears in the store listing.
const { chromium, devices } = require('playwright');
const path = require('path');
const base = 'https://sicher19-dev.github.io/No-Brand-Baseball-App/';
const dev = { ...devices['iPad Pro 11'], viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 }; // 2048x2732 = 13-inch iPad slot

const ROSTER = {
  updated: '2026-11-13',
  pitchers: [{
    id: 'demo', first: 'Pitcher', last: 'Demo', org: 'Your Club', level: '', role: '', hand: 'RHP',
    reports: [
      { id: 'g-pen', kind: 'pen', title: 'Offseason Bullpen Plan', updated: '2026-11-10', url: 'about:blank' },
      { id: 'g-scout', kind: 'scout', title: 'In-Season Scouting Report', updated: '2026-09-21', url: 'about:blank' },
      { id: 'g-reverse', kind: 'reverse', title: 'Reverse Scouting Report', updated: '2026-09-26', url: 'about:blank' },
      { id: 'g-grades', kind: 'grades', title: 'Pitch Grades', updated: '2026-08-13', url: 'about:blank' },
      { id: 'g-exec', kind: 'execution', title: 'Execution Report', updated: '2026-08-02', url: 'about:blank' },
      { id: 'g-picture', kind: 'picture', title: 'Development Picture', updated: '2026-07-15', url: 'about:blank' }
    ]
  }]
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  async function shot(name, hash, session, wait, after) {
    const ctx = await browser.newContext({ ...dev, viewport: { width: 1024, height: 1366 }, locale: 'en-US' });
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
      var swaps = {
        'Setup test message from the demo account': 'Pen went well today, slider felt sharp',
        'Just curious how fast you get the message when it is sent': 'Mobility video is up, let me know what you see',
        'Setup test clip (2 KB placeholder)': 'Mobility check-in'
      };
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var t; while ((t = w.nextNode())) { var k = t.nodeValue.trim(); if (swaps[k]) t.nodeValue = swaps[k]; }
    });
    if (after) await after(page);
    const out = path.join(__dirname, 'ipad-' + name + '.png');
    await page.screenshot({ path: out });
    console.log('wrote', out);
    await ctx.close();
  }
  const sess = { kind: 'pitcher', id: 'demo' };
  await shot('1-login', '#/login', null, 2500);
  await shot('2-home', '#/home', sess, 6000);
  await shot('3-reports', '#/home', sess, 6000, async (page) => {
    const el = await page.$('#report-groups');
    if (el) await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  });
  await shot('4-assess', '#/home', sess, 6000, async (page) => {
    const el = await page.$('#assess-record, #assess-pick');
    if (el) await page.evaluate((e) => e.closest('section, .card, div').scrollIntoView({ block: 'start' }), el);
    await page.waitForTimeout(500);
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
