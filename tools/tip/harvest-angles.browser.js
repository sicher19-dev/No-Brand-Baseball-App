// Tip Detection: collect every camera angle for every pitch from the video
// provider's pitch-log page, as a compact table.
//
// How to use (one season, one pitcher):
//   1. Open the pitcher's pitch log. Add the month filter to the URL so each
//      page holds under 1,000 rows:  ?f={"bm":["4"]}  (calendar month, all
//      seasons; the harvest keeps only the season you pass below).
//   2. Paste this whole file into the console once per month and run
//      nbTipHarvest(2026). Rows accumulate in sessionStorage (same tab).
//   3. When every month is in, run nbTipCopy(). A full-page button appears;
//      click it, then paste the clipboard into
//      private/tip/<id>/clips-<season>-all-angles.tsv.
//      (nbTipDownload() offers the same table as a file download.)
//
// Table columns:
//   play_id         provider play guid (= play_id in our pitch files)
//   game_date       YYYY-MM-DD
//   pitch_num_game  pitcher's pitch number in the game
//   team_dir        team video server path for the game (ends with /)
//   team_num        4-digit play number on the team server
//   team_views      letters of the team-server angles present (A-Z, see docs)
//   cdn_cf          public CDN id of the broadcast center-field clip, if any
//
// A team-server clip URL is  https://<team host>/<team_dir><team_num><letter>.MP4
// (the .MP4 suffix is required even though the table omits it).
//
// Nothing here is part of the app. Keep provider hosts and names out of
// anything a player sees.
(() => {
  const KEY = 'nb_tip_rows', GKEY = 'nb_tip_games';
  // Team video server: any non-CDN host whose path ends in a four-digit pitch number and an angle letter.
  const TEAM = /^https?:\/\/(?!sporty-clips\.)[^/]+\/(.+\/)(\d{4})([A-Z])(\.MP4)?$/i;
  const CDN = 'https://sporty-clips.mlb.com/';
  function walk(root, acc) { for (const e of root.querySelectorAll('*')) { acc.push(e); if (e.shadowRoot) walk(e.shadowRoot, acc); } return acc; }
  function table() {
    const t = walk(document, []).find(e => e.tagName === 'TABLE' && /\d\d\/\d\d\/\d{4}/.test(e.textContent));
    if (!t) throw new Error('pitch log table not found on this page');
    return t.getRootNode().host.__tableData._data;
  }
  const load = k => JSON.parse(sessionStorage.getItem(k) || '{}');
  const save = (k, v) => sessionStorage.setItem(k, JSON.stringify(v));

  window.nbTipHarvest = function (season) {
    if (!season) throw new Error('pass the season, e.g. nbTipHarvest(2026)');
    const d = table(), ids = d.header.map(h => h.columnId), col = n => ids.indexOf(n);
    const rows = load(KEY), games = load(GKEY);
    let added = 0, bad = 0;
    for (const r of d.rows) {
      const g = String(r[col('gameDate')]).slice(0, 10);
      if (!g.startsWith(String(season))) continue;
      const pid = r[col('playGuid')];
      if (!pid || rows[pid]) continue;
      let dir = null, num = null, cf = '';
      const letters = [];
      for (const v of (r[col('videoAngles')] || [])) {
        const m = TEAM.exec(v.url || '');
        if (m) {
          if (dir && dir !== m[1]) bad++;
          if (num && num !== m[2]) bad++;
          dir = m[1]; num = m[2]; letters.push(m[3]);
        } else if (v.view === 'MLB CF') {
          cf = (v.url || '').replace(CDN, '').replace(/\.mp4$/, '');
        }
      }
      if (dir) { if (games[g] && games[g] !== dir) bad++; games[g] = dir; }
      rows[pid] = [g, r[col('pitchNumInGame')], num || '', letters.sort().join(''), cf];
      added++;
    }
    save(KEY, rows); save(GKEY, games);
    const msg = `added ${added}, have ${Object.keys(rows).length} pitches in ${Object.keys(games).length} games` +
      (bad ? `, ${bad} inconsistent paths` : '') + `; this page holds ${d.rows.length} of ${d.totalRows}`;
    console.log(msg); return msg;
  };

  function tsv() {
    const rows = load(KEY), games = load(GKEY);
    const lines = ['play_id\tgame_date\tpitch_num_game\tteam_dir\tteam_num\tteam_views\tcdn_cf'];
    for (const [pid, r] of Object.entries(rows)) lines.push([pid, r[0], r[1], games[r[0]] || '', r[2], r[3], r[4]].join('\t'));
    return lines.join('\n');
  }

  // The clipboard needs a real click, so this installs a full-page button.
  window.nbTipCopy = function () {
    const text = tsv();
    document.getElementById('nbcopy')?.remove();
    const b = document.createElement('button');
    b.id = 'nbcopy'; b.textContent = `COPY ${text.split('\n').length - 1} PITCHES TO CLIPBOARD`;
    b.style.cssText = 'position:fixed;inset:0;z-index:2147483647;font:bold 36px sans-serif;background:#222;color:#fff;border:0;cursor:pointer';
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = 'copied; paste into the tsv file, then click again to close'; }
      catch (e) { b.textContent = 'copy failed: ' + e.message; }
      b.onclick = () => b.remove();
    };
    document.body.appendChild(b);
    return 'click the button';
  };

  window.nbTipDownload = function (id = 'pitcher', season = '') {
    const blob = new Blob([tsv()], { type: 'text/tab-separated-values' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `clips-${season || 'season'}-all-angles-${id}.tsv`; document.body.appendChild(a); a.click(); a.remove();
    return 'download requested';
  };

  window.nbTipReset = () => { sessionStorage.removeItem(KEY); sessionStorage.removeItem(GKEY); return 'cleared'; };
  return 'ready: nbTipHarvest(season), nbTipCopy(), nbTipDownload(id, season), nbTipReset()';
})();
