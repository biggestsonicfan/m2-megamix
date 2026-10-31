/* node:zlib, node:child_process, node:os: what the compiler's path through the
 * tools never calls (an OBJ import's PNGs, the Shenmue disc through Python). */
const no = (what) => () => { throw new Error(`${what} is not in the browser`); };
export const deflateSync = no('zlib.deflateSync');
export const execFileSync = no('child_process.execFileSync');
export const tmpdir = () => '/tmp';
export default { deflateSync, execFileSync, tmpdir };
