/* node:url for the tools in the browser: a file: URL is this site's URL there. */
export const fileURLToPath = (u) => decodeURIComponent(new URL(u).pathname);
export const pathToFileURL = (p) => new URL(`file://${encodeURI(p)}`);
export default { fileURLToPath, pathToFileURL };
