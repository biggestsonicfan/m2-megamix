/* node:path (POSIX) for the tools in the browser. */
import { norm } from './vfs.mjs';
export const join = (...p) => { const j = p.filter((s) => s !== '').join('/'); return j.startsWith('/') ? norm(j) : norm(j).slice(1); };
export const basename = (p, ext) => { const b = String(p).replace(/\/+$/, '').split('/').pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const dirname = (p) => String(p).replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
export const sep = '/';
export default { join, basename, dirname, sep };
