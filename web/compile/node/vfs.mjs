/*
 * The files the tools see in the browser: a path -> contents map that the
 * node:fs stand-in (fs.mjs) reads and writes. A player's file is kept as a
 * File and read when asked (readAt: FileReaderSync in the worker), so a
 * 700 MB disc track is never read whole.
 */
export const files = new Map();            /* path -> Uint8Array | string | { file, size } */
let readAt = null;                          /* (file, offset, length) -> Uint8Array */

export function setReader(fn) { readAt = fn; }

/* A path as the tools give it (a string, a file: URL, a URL of this site), plain. */
export function norm(p) {
    if (p instanceof URL) p = decodeURIComponent(p.pathname);
    else if (/^(file|https?):/.test(p)) p = decodeURIComponent(new URL(p).pathname);
    const out = [];
    for (const s of String(p).split('/')) {
        if (s === '' || s === '.') continue;
        if (s === '..') out.pop(); else out.push(s);
    }
    return '/' + out.join('/');
}

export function put(path, data) { files.set(norm(path), data); }
export function has(path) { return files.has(norm(path)); }
export function isDir(path) {
    const k = norm(path).replace(/\/?$/, '/');
    for (const f of files.keys()) if (f.startsWith(k)) return true;
    return false;
}

/* The bytes at path (a copy of the stored array, or the whole File read), or null. */
export function bytes(path) {
    const e = files.get(norm(path));
    if (e === undefined) return null;
    if (typeof e === 'string') return new TextEncoder().encode(e);
    if (e instanceof Uint8Array) return e;
    return read(path, 0, e.size);
}

/* `n` bytes of path from `off` (a stored array or a File). */
export function read(path, off, n) {
    const e = files.get(norm(path));
    if (e === undefined) throw new Error(`ENOENT: ${norm(path)}`);
    if (e instanceof Uint8Array) return e.subarray(off, off + n);
    if (typeof e === 'string') return new TextEncoder().encode(e).subarray(off, off + n);
    if (!readAt) throw new Error('vfs: no file reader');
    return readAt(e.file, off, Math.max(0, Math.min(n, e.size - off)));
}

export function size(path) {
    const e = files.get(norm(path));
    return e === undefined ? -1 : typeof e === 'string' ? new TextEncoder().encode(e).length : e instanceof Uint8Array ? e.length : e.size;
}

/* The names in a folder (with `recursive`, every file below it, relative). */
export function list(path, recursive = false) {
    const k = norm(path).replace(/\/?$/, '/');
    const out = new Set();
    for (const f of files.keys()) {
        if (!f.startsWith(k)) continue;
        const rest = f.slice(k.length);
        if (recursive) {
            const parts = rest.split('/');
            for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
        } else out.add(rest.split('/')[0]);
    }
    return [...out].sort();
}
