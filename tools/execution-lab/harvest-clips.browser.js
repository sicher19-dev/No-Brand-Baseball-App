// Execution Lab: collect per-pitch clip URLs from the video provider's
// pitch-log page. Paste this whole file into the browser console on the
// pitcher's pitch log (one month at a time: the page loads at most 1,000
// rows per query), then run `nbClipsDownload()` once every month is in.
//
// It reads the table's own data (play id + camera angles), keeps two angles,
// accumulates across page loads in localStorage, and downloads
// nb-clips-<id>.tsv.gz. Convert it with tools/execution-lab/clips-from-tsv.mjs.
//
// Nothing here is part of the app. Keep provider hosts and names out of
// anything a player sees.
(() => {
  const WANT = { 'MLB Home': 'h', 'MLB High Home': 'hh' };
  function walk(root, acc) { for (const e of root.querySelectorAll('*')) { acc.push(e); if (e.shadowRoot) walk(e.shadowRoot, acc); } return acc; }
  function table() {
    const t = walk(document, []).find(e => e.tagName === 'TABLE' && /\d\d\/\d\d\/\d{4}/.test(e.textContent));
    if (!t) throw new Error('pitch log table not found on this page');
    return t.getRootNode().host.__tableData._data;
  }
  window.nbClipsHarvest = function () {
    const d = table(), ids = d.header.map(h => h.columnId);
    const gi = ids.indexOf('playGuid'), vi = ids.indexOf('videoAngles');
    const store = JSON.parse(localStorage.getItem('nb_clips') || '{}');
    let added = 0;
    for (const r of d.rows) {
      const g = r[gi]; if (!g || store[g]) continue;
      const o = {}; for (const v of (r[vi] || [])) { const k = WANT[v.view]; if (k) o[k] = v.url; }
      store[g] = o; added++;
    }
    localStorage.setItem('nb_clips', JSON.stringify(store));
    const msg = `added ${added}, have ${Object.keys(store).length}, this page holds ${d.rows.length} of ${d.totalRows}`;
    console.log(msg); return msg;
  };
  window.nbClipsDownload = async function (id = 'pitcher') {
    const store = JSON.parse(localStorage.getItem('nb_clips') || '{}');
    const P = 'https://sporty-clips.mlb.com/', strip = u => (u || '').replace(P, '').replace(/\.mp4$/, '');
    const tsv = Object.entries(store).map(([g, o]) => g + '\t' + strip(o.h) + '\t' + strip(o.hh)).join('\n');
    const cs = new CompressionStream('gzip'); const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(tsv)); w.close();
    const blob = new Blob([await new Response(cs.readable).arrayBuffer()], { type: 'application/gzip' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `nb-clips-${id}.tsv.gz`; document.body.appendChild(a); a.click(); a.remove();
    return `downloaded ${Object.keys(store).length} pitches`;
  };
  window.nbClipsReset = () => localStorage.removeItem('nb_clips');
  return window.nbClipsHarvest();
})();
