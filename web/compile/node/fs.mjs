/* node:fs for the tools in the browser, over vfs.mjs. */
import * as vfs from './vfs.mjs';
import { Buffer } from './buffer.mjs';

const enoent = (p) => Object.assign(new Error(`ENOENT: no such file, '${vfs.norm(p)}'`), { code: 'ENOENT' });

export function readFileSync(p, opt) {
    const enc = typeof opt === 'string' ? opt : opt?.encoding;
    const b = vfs.bytes(p);
    if (!b) throw enoent(p);
    if (enc) return Buffer.from(b.buffer, b.byteOffset, b.length).toString(enc);
    return Buffer.from(b.buffer, b.byteOffset, b.length);
}

export function writeFileSync(p, d) {
    vfs.put(p, typeof d === 'string' ? d : new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d));
}

export function existsSync(p) { return vfs.has(p) || vfs.isDir(p); }
export function mkdirSync() {}
export function readdirSync(p, opt = {}) {
    if (!vfs.isDir(p)) throw enoent(p);
    return vfs.list(p, !!opt.recursive);
}
export function statSync(p) {
    if (!existsSync(p)) throw enoent(p);
    return { size: vfs.size(p), isDirectory: () => !vfs.has(p), isFile: () => vfs.has(p) };
}
export function mkdtempSync(prefix) { return `${prefix}${Math.random().toString(36).slice(2, 8)}`; }
export function rmSync() {}

export default { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync };
