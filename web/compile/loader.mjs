/*
 * Run the repo's Node tools (tools/board/*.mjs and what they import) in a
 * worker. A worker has no import map, so a module that imports node:fs or
 * another Node built-in (the stand-ins in node/), or a module redirected
 * (tests/node-roms.mjs to node-roms.mjs), is fetched and imported from a blob:
 * URL with those imports, and its relative ones, pointed where they go, and
 * its import.meta.url put back to the URL it came from, which the tools
 * resolve their files against (vfs.mjs holds this site's paths). So is every
 * module that imports one of those. The others (noclip's, the game's, which
 * import one another in cycles a blob cannot make) are imported as they are.
 *
 * Modules under node/ are imported as they are too, so the worker and the
 * tools share one vfs.mjs.
 */
const HERE = new URL('./', import.meta.url).href;
const NATIVE = new URL('node/', HERE).href;

const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])((?:\.{1,2}\/|\/|node:)[^'"\n]+)\2/g;

export function makeLoader(redirect = {}) {
    const map = {
        'node:fs': `${NATIVE}fs.mjs`, 'node:url': `${NATIVE}url.mjs`, 'node:path': `${NATIVE}path.mjs`,
        'node:zlib': `${NATIVE}unavailable.mjs`, 'node:child_process': `${NATIVE}unavailable.mjs`,
        'node:os': `${NATIVE}unavailable.mjs`, 'node:buffer': `${NATIVE}buffer.mjs`,
        ...redirect,
    };
    const mods = new Map();                 /* url -> { src, deps: { spec: url | null }, own, blob } */

    /* The graph from `url`: each module's source and where its imports go.
     * Every module is fetched once, all at once (a cycle waits on nothing). */
    async function crawl(url) {
        const pending = [];
        const visit = (u) => {
            if (mods.has(u)) return;
            const m = { deps: {}, own: false };
            mods.set(u, m);
            pending.push((async () => {
                const r = await fetch(u);
                if (!r.ok) { m.missing = true; return; }
                m.src = await r.text();
                for (const s of new Set([...m.src.matchAll(SPEC)].map((x) => x[3]))) {
                    if (s.startsWith('node:')) {
                        if (!map[s]) throw new Error(`loader: ${u} imports ${s}, which has no stand-in`);
                        m.deps[s] = map[s];
                        m.own = true;
                        continue;
                    }
                    const abs = new URL(s, u).href;
                    const to = map[abs] ?? abs;
                    if (to !== abs) m.own = true;
                    m.deps[s] = to;
                    if (!to.startsWith(NATIVE)) visit(to);
                }
            })());
        };
        visit(url);
        while (pending.length) await pending.shift();
        /* a quoted path in a comment is no module: it stays as it is */
        for (const m of mods.values()) for (const [s, d] of Object.entries(m.deps)) if (mods.get(d)?.missing) m.deps[s] = null;
    }

    /* Which modules go through a blob: their own imports need it, or an import's does. */
    function mark() {
        for (let changed = true; changed;) {
            changed = false;
            for (const m of mods.values()) {
                if (m.own || m.missing) continue;
                if (Object.values(m.deps).some((d) => d && mods.get(d)?.own)) { m.own = true; changed = true; }
            }
        }
    }

    function blob(url, stack = []) {
        const m = mods.get(url);
        if (!m.own) return url;
        if (m.blob) return m.blob;
        if (stack.includes(url)) throw new Error(`loader: an import cycle through ${url} needs the Node stand-ins`);
        const to = {};
        for (const [s, d] of Object.entries(m.deps)) to[s] = d && (d.startsWith(NATIVE) ? d : blob(d, [...stack, url]));
        const src = m.src.replace(SPEC, (all, a, q, s) => (to[s] ? `${a}${q}${to[s]}${q}` : all))
            .replace(/\bimport\.meta\.url\b/g, JSON.stringify(url));
        m.blob = URL.createObjectURL(new Blob([src, `\n//# sourceURL=${url}`], { type: 'text/javascript' }));
        return m.blob;
    }

    /* import() a module of this site (its URL) through the loader */
    return async (url) => {
        url = new URL(url, HERE).href;
        await crawl(url);
        mark();
        return import(blob(url));
    };
}
