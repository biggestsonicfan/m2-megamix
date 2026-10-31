/*
 * compile.html: the player's files, the configuration and its link, a build
 * (worker.mjs, one worker per build), and what to do with the set: download
 * it, or play it in m2-hle2's web build, which this page opens and posts the
 * zip to (?rom=opener: a set made in this browser has no URL to give).
 *
 * The link (#lineup=…&zip=…&moves=…) is the configuration and the SHA-256 of
 * the zip it made, so whoever opens it can tell they built the same bytes;
 * m2-hle2 puts boards with the same zip on the same netplay channel.
 */
const $ = (id) => document.getElementById(id);
const SITE = new URL('../', location.href).href;
/* m2-hle2's web build; another only for a test served on this machine */
const PLAYER = (() => {
    const p = new URLSearchParams(location.search).get('player');
    if (p) {
        const u = new URL(p, location.href);
        if (u.origin === location.origin || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return u.href;
    }
    return 'https://arcade.sonicthefighte.rs/sfight.html';
})();
const FM_PATH = '/home/source/repos/ai/Fighters Megamix (Prototype - Apr 08, 1997)/Track01.bin';

/* ---- what the build reads ---------------------------------------------------- */

const zipNeed = (id, what) => ({ id, what, label: `${id}.zip`, path: `/roms/${id}.zip` });
const NEED = [
    zipNeed('sfight', 'Sonic the Fighters (MAME set)'),
    zipNeed('vf2', 'Virtua Fighter 2 (MAME set)'),
    zipNeed('fvipers', 'Fighting Vipers (MAME set)'),
    zipNeed('daytona', 'Daytona USA (MAME set)'),
    zipNeed('doa', 'Dead or Alive (MAME set)'),
    zipNeed('doab', 'Dead or Alive, its clone (MAME set)'),
    { id: 'fm', label: 'Track01.bin', what: 'Fighters Megamix, the Saturn prototype of Apr 08, 1997: its data track (MODE1/2352)' },
    { id: 'shenmue', label: '.gdi, TRACK03.ISO, TRACK06.ISO', what: 'Shenmue beta 0.400, disc 3: its GD-ROM dump' },
];
const have = {};                 /* id -> [{ path, file }] */

function showNeed() {
    $('need').replaceChildren(...NEED.map((n) => {
        const tr = document.createElement('tr');
        const ok = !!have[n.id];
        tr.innerHTML = `<td class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '·'}</td><td class="what"><b></b><br><small></small></td>`;
        tr.querySelector('b').textContent = n.label;
        tr.querySelector('small').textContent = ok ? `${n.what}: ${have[n.id].map((x) => x.file.name).join(', ')}` : n.what;
        return tr;
    }));
    $('build').disabled = NEED.some((n) => !have[n.id]);
}

const head = async (file, off, n) => new Uint8Array(await file.slice(off, off + n).arrayBuffer());
const ascii = (b) => String.fromCharCode(...b);

/* Sort a pick of files into what the build reads: the sets by name, the
 * Saturn track by its volume, the GD-ROM by its .gdi and the tracks it names. */
async function addFiles(list) {
    const files = [...list];
    for (const f of files) {
        const name = f.name.toLowerCase();
        const z = NEED.find((n) => n.path && name === `${n.id}.zip`);
        if (z) { have[z.id] = [{ path: z.path, file: f }]; continue; }
        if (/\.bin$/.test(name) && f.size > 16 * 2352 + 2048) {
            const pvd = await head(f, 16 * 2352 + 16, 2048);
            if (ascii(pvd.subarray(1, 6)) === 'CD001' && ascii(pvd.subarray(40, 56)) === 'FIGHTERS_MEGAMIX') have.fm = [{ path: FM_PATH, file: f }];
        }
    }
    for (const g of files.filter((f) => /\.gdi$/i.test(f.name))) {
        const text = await g.text();
        const names = text.split(/\r?\n/).slice(1).map((l) => l.trim().match(/^\d+\s+(\d+)\s+4\s+\d+\s+("[^"]+"|\S+)/))
            .filter((m) => m && +m[1] >= 45000).map((m) => m[2].replace(/^"|"$/g, ''));
        const sameDir = (f) => (f.webkitRelativePath || '').replace(/[^/]*$/, '') === (g.webkitRelativePath || '').replace(/[^/]*$/, '');
        const tracks = names.map((t) => files.find((f) => f.name.toLowerCase() === t.toLowerCase() && sameDir(f)));
        if (names.length && tracks.every(Boolean))
            have.shenmue = [{ path: `/shenmue/${g.name}`, file: g }, ...tracks.map((f, i) => ({ path: `/shenmue/${names[i]}`, file: f }))];
        else log(`${g.name}: its tracks ${names.join(', ')} were not all picked with it`);
    }
    showNeed();
}

/* ---- the moves, and the link ------------------------------------------------- */

let moves = {};                  /* name -> text */

function showMoves() {
    const n = Object.keys(moves);
    $('moves-list').textContent = n.length ? n.join(', ') : 'none';
    $('moves-clear').hidden = !n.length;
}

const b64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const squeeze = async (text) => b64u(new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()));
const unsqueeze = async (s) => new Response(new Blob([unb64u(s)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();

async function linkFor(zipHash) {
    const p = new URLSearchParams({ lineup: $('lineup').value });
    if (Object.keys(moves).length) p.set('moves', await squeeze(JSON.stringify(moves)));
    if (zipHash) p.set('zip', zipHash);
    return `${location.origin}${location.pathname}#${p}`;
}

let wanted = null;               /* the link's zip hash */
async function readLink() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('lineup') && [...$('lineup').options].some((o) => o.value === p.get('lineup'))) $('lineup').value = p.get('lineup');
    if (p.get('moves')) moves = JSON.parse(await unsqueeze(p.get('moves')));
    wanted = p.get('zip');
    if (wanted || p.get('moves')) {
        $('link-note').hidden = false;
        $('link-note').textContent = `This is a shared configuration${wanted ? `: its build is ${wanted.slice(0, 16)}…, and yours will be checked against it` : ''}.`;
    }
    showMoves();
}

/* ---- the build --------------------------------------------------------------- */

function log(line) {
    $('log').hidden = false;
    $('log').textContent += line + '\n';
    $('log').scrollTop = $('log').scrollHeight;
}

const STEPS = { kit: 'getting the kit', bake: 'baking the fighters and stages', import: 'importing the assets (a minute or so)', program: 'putting the program together', zip: 'writing the zip' };

function build() {
    $('build').disabled = true;
    $('result').hidden = true;
    $('log').textContent = '';
    const lineup = $('lineup').value;
    const t0 = performance.now();
    const w = new Worker(new URL('worker.mjs', import.meta.url), { type: 'module' });
    w.onmessage = ({ data: m }) => {
        if (m.log !== undefined) log(m.log);
        if (m.step) { $('step').textContent = STEPS[m.step] ?? m.step; log(`-- ${m.step}`); }
        if (m.error) { $('step').textContent = 'the build stopped'; log(m.error); w.terminate(); $('build').disabled = false; }
        if (m.done) {
            w.terminate();
            $('build').disabled = false;
            $('step').textContent = `built in ${((performance.now() - t0) / 1000).toFixed(0)} s`;
            const r = { ...m.done, lineup, moves };
            keep(r);
            showResult(r);
        }
    };
    w.onerror = (e) => { $('step').textContent = 'the build stopped'; log(e.message ?? String(e)); $('build').disabled = false; };
    w.postMessage({
        site: SITE, kit: new URL(`kit/${lineup}/`, new URL('../', import.meta.url)).href, lineup,
        inputs: Object.values(have).flat(), moves,
    });
}

async function showResult(r) {
    const el = $('result');
    el.hidden = false;
    const link = await linkFor(r.sha256);
    const edited = Object.keys(r.moves ?? {}).length > 0;
    let verdict;
    if (wanted) verdict = wanted === r.sha256
        ? '<span class="same">The same set as the link\'s: you can play each other.</span>'
        : '<span class="differ">Not the link\'s set: your files differ from theirs, or the site has changed since.</span>';
    else if (r.same) verdict = '<span class="same">The same set as the project\'s own build of this lineup.</span>';
    else verdict = `<span class="differ">Not the project's own build${edited ? ' (your moves change it)' : ''}: ${r.differ.length} of its files differ (${r.differ.join(', ')}).</span>`;
    el.innerHTML = `<div>${verdict}</div>
        <div class="hash">zip SHA-256 ${r.sha256}</div>
        <div class="row"><button id="play" class="go">Play</button> <a id="save" download="sfight.zip">Download sfight.zip</a></div>
        <div>The link to this build (send it to whoever you play):</div>
        <input id="link" type="text" readonly>`;
    $('link').value = link;
    $('link').onclick = () => $('link').select();
    const url = URL.createObjectURL(new Blob([r.zip], { type: 'application/zip' }));
    $('save').href = url;
    $('play').onclick = () => play(r.zip);
}

/* m2-hle2 asks for the set once it is up ({ m2hle: 'ready' }), and gets a copy. */
function play(zip) {
    const u = new URL(PLAYER);
    u.searchParams.set('homebrew', '1');
    u.searchParams.set('rom', 'opener');
    const win = window.open(u.href, '_blank');
    if (!win) { log('the player\'s window was blocked: allow pop-ups for this page'); return; }
    const origin = u.origin;
    const on = (e) => {
        if (e.source !== win || e.origin !== origin || e.data?.m2hle !== 'ready') return;
        window.removeEventListener('message', on);
        const copy = zip.slice().buffer;
        win.postMessage({ m2hle: 'rom', zip: copy }, origin, [copy]);
    };
    window.addEventListener('message', on);
}

/* ---- the last build, kept in this browser ------------------------------------ */

const db = () => new Promise((ok, no) => {
    const q = indexedDB.open('m2-megamix-compile', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('builds');
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
});
async function keep(r) {
    try {
        const d = await db();
        d.transaction('builds', 'readwrite').objectStore('builds').put({ zip: r.zip, sha256: r.sha256, lineup: r.lineup, moves: r.moves, same: r.same, differ: r.differ }, 'last');
    } catch (e) { log(`(the build is not kept in this browser: ${e.message})`); }
}
async function lastBuild() {
    try {
        const d = await db();
        return await new Promise((ok) => {
            const q = d.transaction('builds').objectStore('builds').get('last');
            q.onsuccess = () => ok(q.result);
            q.onerror = () => ok(null);
        });
    } catch { return null; }
}

/* ---- the page ---------------------------------------------------------------- */

$('pick-files').onclick = () => $('files').click();
$('pick-dir').onclick = () => $('dir').click();
$('files').onchange = (e) => addFiles(e.target.files);
$('dir').onchange = (e) => addFiles(e.target.files);
$('pick-moves').onclick = () => $('moves').click();
$('moves').onchange = async (e) => {
    for (const f of e.target.files) moves[f.name] = await f.text();
    e.target.value = '';
    showMoves();
};
$('moves-clear').onclick = () => { moves = {}; showMoves(); };
$('build').onclick = build;

/* a dropped folder: every file under it */
async function walk(entry, out) {
    if (entry.isFile) { out.push(await new Promise((ok, no) => entry.file(ok, no))); return; }
    const r = entry.createReader();
    for (let batch; (batch = await new Promise((ok, no) => r.readEntries(ok, no))).length;)
        for (const e of batch) await walk(e, out);
}
const drop = $('drop');
for (const t of ['dragenter', 'dragover']) window.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) window.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); });
window.addEventListener('drop', async (e) => {
    const out = [];
    for (const it of [...(e.dataTransfer?.items ?? [])]) {
        const entry = it.webkitGetAsEntry?.();
        if (entry) await walk(entry, out); else if (it.getAsFile()) out.push(it.getAsFile());
    }
    addFiles(out);
});

showNeed();
await readLink();
const last = await lastBuild();
if (last && (!wanted || wanted === last.sha256)) {
    log(`your last build (${last.lineup}, ${last.sha256.slice(0, 16)}…) is kept in this browser`);
    if (!wanted) { $('lineup').value = last.lineup; moves = last.moves ?? {}; showMoves(); }
    showResult(last);
}
