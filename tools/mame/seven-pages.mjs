// Which models in a screen-pages.lua (or fight-models.lua) log sample sheet 1's
// seven Akira pages (set 1 pages 3, 12, 15, 16, 18, 19, 21), per mode key.
//   node tools/mame/seven-pages.mjs <log>     node tools/mame/seven-pages.mjs --fight
import { readFileSync } from 'node:fs';
const R = new URL('../..', import.meta.url).pathname;
const { loadNodeGames } = await import(R + '/tests/node-roms.mjs');
const { decodeModel } = await import(R + '/vendor/noclip/js/model.js');
const G = await loadNodeGames(); const stf = G.stf.rom;
const PAGES = { 3: [0, 768], 12: [768, 0], 15: [768, 768], 16: [1024, 0], 18: [1280, 0], 19: [1280, 256], 21: [1536, 256] };
const cache = new Map();
function pagesOf(id) {
  if (cache.has(id)) return cache.get(id);
  const m = decodeModel(stf, id); const hit = new Map(); let s1 = 0;
  if (m) for (let i = 0; i < m.tiles.length; i += 4) {
    const [tx, ty, tw, th] = m.tiles.subarray(i, i + 4); if (!tw || ty < 1024) continue; s1++;
    const y = ty - 1024;
    for (const [p, [px, py]] of Object.entries(PAGES))
      if (tx < px + 256 && tx + tw > px && y < py + 256 && y + th > py) hit.set(+p, (hit.get(+p) || new Set()).add(`${tx},${y} ${tw}x${th}`));
  }
  const r = { hit, s1, ok: !!m }; cache.set(id, r); return r;
}
if (process.argv[2] === '--fight') {   // sanity: the fight list must hit none
  const ids = readFileSync(R + '/docs/data/stf-fight-models.txt', 'utf8').split('\n').filter(l => /^\d/.test(l)).map(l => +l.split(' ')[0]);
  const bad = ids.filter(id => pagesOf(id).hit.size); console.log('fight models', ids.length, 'hitting the seven pages', bad);
  process.exit(0);
}
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const f = line.split(' '); if (!/^m\d/.test(f[0])) continue;
  const ids = f.slice(3).map(x => +x.split(':')[0]);
  const hits = []; let undec = 0, s1m = 0;
  for (const id of ids) { const r = pagesOf(id); if (!r.ok) undec++; if (r.s1) s1m++;
    for (const [p, set] of r.hit) hits.push(`model ${id} page ${p}: ${[...set].join('; ')}`); }
  console.log(`${f[0]} ${f[1]} ${f[2]} models=${ids.length} sheet1=${s1m} undecoded=${undec} hits=${hits.length}`);
  for (const h of hits) console.log('   ', h);
}
