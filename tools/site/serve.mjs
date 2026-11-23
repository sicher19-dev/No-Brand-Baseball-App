// Local preview of the built site: node tools/site/build.mjs, then node tools/site/serve.mjs  ->  http://localhost:8790/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '_site');
const PORT = Number(process.env.PORT || 8790);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf' };

createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    let file = join(OUT, p);
    if (!file.startsWith(OUT)) throw new Error('outside');
    let s = await stat(file).catch(() => null);
    if (s && s.isDirectory()) { file = join(file, 'index.html'); s = await stat(file).catch(() => null); }
    if (!s && !extname(file)) { file += '.html'; s = await stat(file).catch(() => null); }
    if (!s) { res.writeHead(404, { 'content-type': TYPES['.html'] }); res.end(await readFile(join(OUT, '404.html')).catch(() => 'Not found')); return; }
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    const buf = await readFile(file);
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) { // video scrubbing needs range requests
      const a = Number(range[1]), b = range[2] ? Number(range[2]) : buf.length - 1;
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${a}-${b}/${buf.length}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 });
      res.end(buf.subarray(a, b + 1));
    } else { res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' }); res.end(buf); }
  } catch (e) { res.writeHead(500); res.end('error'); }
}).listen(PORT, () => console.log(`No Brand site preview: http://localhost:${PORT}/`));
