/*
 * board/src/gen/poses.h as data: the bytes the i960 build would make of it.
 *
 * poses.h (tools/board/bake-board.mjs) is read from the ROM sets, so the
 * program's own build must not hold it: the browser's compiler
 * (web/compile.html) makes it again from the player's ROMs. This turns the
 * header's C (struct typedefs, `static const` objects, their initializers)
 * into a blob laid out as i960-elf-gcc lays it out (little-endian, natural
 * alignment), at a fixed address, and a header that declares the same names
 * `extern`. The board links the blob as its .poses section, the top of the
 * first program EPROM half (below StF's ROM tables at 0x80000):
 *
 *   node tools/board/c-data.mjs board/src/gen/poses.h <outdir>
 *       -> poses.bin, poses.s, poses_decl.h, poses.opt (the link's --section-start)
 *
 * Only the C bake-board.mjs writes is handled; anything else stops it.
 */

export const POSES_END = 0x80000;            /* .stfrom (StF's ROM from 0x80000) starts here */
const ALIGN = 16;                            /* every object starts on a quad word */

const PRIM = {
    u8: [1, 'u'], char: [1, 'i'], s8: [1, 'i'], u16: [2, 'u'], short: [2, 'i'], s16: [2, 'i'],
    u32: [4, 'u'], int: [4, 'i'], s32: [4, 'i'], float: [4, 'f'],
};

function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/* ---- the initializer's tokens --------------------------------------------- */

function tokenize(s) {
    const out = [];
    const re = /\s*(?:("(?:[^"\\]|\\.)*")|([-+]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)[uUlLfF]*)|([A-Za-z_]\w*)|([{},&]))/y;
    let m;
    while (re.lastIndex < s.length) {
        const at = re.lastIndex;
        if (!(m = re.exec(s))) {
            if (/^\s*$/.test(s.slice(at))) break;
            throw new Error(`c-data: cannot read "${s.slice(at, at + 40)}"`);
        }
        if (m[1]) out.push({ str: JSON.parse(m[1]) });
        else if (m[2]) out.push({ num: m[2] });
        else if (m[3]) out.push({ id: m[3] });
        else out.push({ p: m[4] });
    }
    return out;
}

/* An initializer: a value, or { list: [...] } for a braced one. */
function parseInit(toks, i = 0) {
    const t = toks[i];
    if (t?.p === '{') {
        const list = [];
        i++;
        while (toks[i]?.p !== '}') {
            const [v, j] = parseInit(toks, i);
            list.push(v);
            i = j;
            if (toks[i]?.p === ',') i++;
            else if (toks[i]?.p !== '}') throw new Error('c-data: , or } expected');
        }
        return [{ list }, i + 1];
    }
    if (t?.p === '&') return [{ addr: toks[i + 1].id }, i + 2];
    if (!t || t.p) throw new Error('c-data: value expected');
    return [t, i + 1];
}

/* ---- types ---------------------------------------------------------------- */

/* A declarator's text ("*const name[8]", "m[12]", "*v") on a base type. */
function declarator(text, base, defs) {
    const m = text.trim().match(/^((?:\*\s*(?:const\s*)?)*)(\w+)((?:\s*\[[^\]]*\])*)$/);
    if (!m) throw new Error(`c-data: cannot read the declarator "${text}"`);
    const ptr = (m[1].match(/\*/g) ?? []).length;
    let type = base;
    for (let k = 0; k < ptr; k++) type = { ptr: type };
    const dims = [...m[3].matchAll(/\[([^\]]*)\]/g)].map((d) => (d[1].trim() === '' ? null : evalNum(d[1], defs)));
    for (let k = dims.length - 1; k >= 0; k--) type = { arr: type, n: dims[k] };
    return { name: m[2], type, ptrText: m[1], dims };
}

function baseType(text, structs) {
    const t = text.replace(/\bconst\b/g, '').trim();
    if (PRIM[t]) return { prim: t };
    if (structs[t]) return structs[t];
    throw new Error(`c-data: unknown type "${text}"`);
}

function sizeOf(t) {
    if (t.prim) return PRIM[t.prim][0];
    if (t.ptr) return 4;
    if (t.arr) return sizeOf(t.arr) * t.n;
    return t.size;
}
function alignOf(t) {
    if (t.prim) return PRIM[t.prim][0];
    if (t.ptr) return 4;
    if (t.arr) return alignOf(t.arr);
    return t.align;
}
const up = (n, a) => Math.ceil(n / a) * a;

function parseStruct(body, name, structs, defs) {
    const fields = [];
    for (const decl of body.split(';').map((d) => d.trim()).filter(Boolean)) {
        const m = decl.match(/^((?:const\s+)?\w+(?:\s+const)?)\s+(.*)$/);
        const base = baseType(m[1], structs);
        for (const d of m[2].split(',')) fields.push(declarator(d, base, defs));
    }
    let off = 0, align = 1;
    for (const f of fields) {
        const a = alignOf(f.type);
        off = up(off, a);
        f.off = off;
        off += sizeOf(f.type);
        align = Math.max(align, a);
    }
    return { name, fields, size: up(off, align), align };
}

function evalNum(text, defs) {
    let s = text.trim();
    for (let k = 0; k < 8 && /^[A-Za-z_]\w*$/.test(s); k++) {
        if (!(s in defs)) throw new Error(`c-data: ${s} is not defined`);
        s = defs[s];
    }
    const v = Number(s.replace(/[uUlLfF]+$/, '').replace(/^\+/, ''));
    if (Number.isNaN(v) && !/^-?0[xX]/.test(s)) throw new Error(`c-data: "${text}" is not a number`);
    return /^-?0[xX]/.test(s) ? (s.startsWith('-') ? -parseInt(s.slice(1).replace(/[uUlL]+$/, ''), 16) : parseInt(s.replace(/[uUlL]+$/, ''), 16)) : v;
}

/* ---- the header ----------------------------------------------------------- */

/* Read poses.h: its #defines, struct typedefs and objects. */
export function parseHeader(src) {
    const s = stripComments(src);
    const defs = {}, structs = {}, objects = [], typedefs = [], defines = [];
    let i = 0;
    while (i < s.length) {
        const rest = s.slice(i);
        let m;
        if ((m = rest.match(/^\s+/))) { i += m[0].length; continue; }
        if ((m = rest.match(/^#\s*define\s+(\w+)(?:[ \t]+([^\n]*))?\n/))) {
            if (m[2] !== undefined) { defs[m[1]] = m[2].trim(); defines.push(m[0].trim()); }
            i += m[0].length; continue;
        }
        if ((m = rest.match(/^#[^\n]*\n/))) { i += m[0].length; continue; }
        if ((m = rest.match(/^typedef\s+struct\s*\{([^}]*)\}\s*(\w+)\s*;/))) {
            structs[m[2]] = parseStruct(m[1], m[2], structs, defs);
            typedefs.push(m[0].replace(/\s+/g, ' '));
            i += m[0].length; continue;
        }
        if ((m = rest.match(/^static\s+const\s+(\w+)\s+((?:const\s+)?)/))) {
            /* static const T d1 = init, d2 = init; */
            const base = baseType(m[1], structs);
            let j = i + m[0].length;
            for (;;) {
                const eq = s.indexOf('=', j);
                const d = declarator(s.slice(j, eq), base, defs);
                /* the initializer runs to the , or ; outside braces and strings */
                let k = eq + 1, depth = 0, inStr = false;
                for (; k < s.length; k++) {
                    const c = s[k];
                    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
                    if (c === '"') inStr = true;
                    else if (c === '{') depth++;
                    else if (c === '}') depth--;
                    else if ((c === ',' || c === ';') && depth === 0) break;
                }
                const toks = tokenize(s.slice(eq + 1, k));
                const [init, used] = parseInit(toks);
                if (used !== toks.length) throw new Error(`c-data: ${d.name}: more after its initializer`);
                if (d.type.arr && d.type.n === null) d.type.n = init.list.length;
                objects.push({ ...d, base: m[1] + (m[2] ? ' const' : ''), init });
                j = k + 1;
                if (s[k] === ';') break;
            }
            i = j; continue;
        }
        throw new Error(`c-data: cannot read "${rest.slice(0, 60)}"`);
    }
    return { defs, structs, objects, typedefs, defines };
}

/* Lay the objects out from `base`: { bytes, symbols: name -> address }. */
export function layout(h, base) {
    let off = 0;
    for (const o of h.objects) {
        off = up(off, ALIGN);
        o.off = off;
        off += sizeOf(o.type);
    }
    /* the string literals after the objects, one copy of each */
    const strings = new Map();
    const collect = (v) => {
        if (v?.list) v.list.forEach(collect);
        else if (v?.str !== undefined && !strings.has(v.str)) strings.set(v.str, 0);
    };
    h.objects.forEach((o) => collect(o.init));
    for (const k of strings.keys()) { strings.set(k, off); off += new TextEncoder().encode(k).length + 1; }
    const size = up(off, ALIGN);
    const out = new Uint8Array(size), dv = new DataView(out.buffer);
    const sym = Object.fromEntries(h.objects.map((o) => [o.name, base + o.off]));
    for (const [k, at] of strings) out.set(new TextEncoder().encode(k), at);

    const scalar = (t, at, v, where) => {
        if (t.ptr) {
            let a = 0;
            if (v.str !== undefined) a = base + strings.get(v.str);
            else if (v.addr || v.id) {
                const n = v.addr ?? v.id;
                if (!(n in sym)) throw new Error(`c-data: ${where}: ${n} is not an object here`);
                a = sym[n];
            } else if (evalNum(v.num, h.defs) !== 0) throw new Error(`c-data: ${where}: a pointer from a number`);
            dv.setUint32(at, a >>> 0, true);
            return;
        }
        const [n, kind] = PRIM[t.prim];
        if (v.num === undefined && v.id === undefined) throw new Error(`c-data: ${where}: a number expected`);
        const x = evalNum(v.num ?? v.id, h.defs);
        if (kind === 'f') dv.setFloat32(at, x, true);
        else if (n === 1) dv.setUint8(at, x & 0xff);
        else if (n === 2) dv.setUint16(at, x & 0xffff, true);
        else dv.setUint32(at, x >>> 0, true);
    };
    const put = (t, at, v, where) => {
        if (t.arr) {
            if (t.arr.prim === 'char' && v.str !== undefined) { out.set(new TextEncoder().encode(v.str), at); return; }
            const list = v.list ?? [v];
            if (list.length > t.n) throw new Error(`c-data: ${where}: ${list.length} values for ${t.n}`);
            list.forEach((e, k) => put(t.arr, at + k * sizeOf(t.arr), e, where));
        } else if (t.fields) {
            const list = v.list ?? [v];
            if (list.length > t.fields.length) throw new Error(`c-data: ${where}: too many values for ${t.name}`);
            list.forEach((e, k) => put(t.fields[k].type, at + t.fields[k].off, e, `${where}.${t.fields[k].name}`));
        } else scalar(t, at, v.list ? v.list[0] : v, where);
    };
    for (const o of h.objects) put(o.type, o.off, o.init, o.name);
    return { bytes: out, symbols: sym };
}

/* The board's view of it: the typedefs and #defines, and each object extern. */
export function declHeader(h) {
    const dims = (o) => {
        const out = [];
        for (let t = o.type; t.arr; t = t.arr) out.push(`[${t.n}]`);
        return out.join('');
    };
    return [
        '/* Generated by tools/board/c-data.mjs from board/src/gen/poses.h: do not edit. */',
        '#ifndef POSES_DECL_H', '#define POSES_DECL_H', '',
        ...h.typedefs, ...h.defines, '',
        ...h.objects.map((o) => `extern const ${o.base.replace(/ const$/, '')} ${o.ptrText.replace(/\s+/g, '').replace(/const/g, 'const ')}${o.base.endsWith(' const') ? 'const ' : ''}${o.name}${dims(o)};`),
        '', '#endif', '',
    ].join('\n');
}

/* Everything the build (and the browser) needs from one poses.h. */
export function posesData(src) {
    const h = parseHeader(src);
    const size = layout(h, 0).bytes.length;
    const base = POSES_END - size;
    if (base & (ALIGN - 1)) throw new Error('c-data: unaligned base');
    const { bytes, symbols } = layout(h, base);
    const asm = [
        '/* Generated by tools/board/c-data.mjs: poses.h\'s objects, laid out in poses.bin */',
        '\t.section .poses,"a"', '\t/* C names carry a leading _ on i960 ELF */', '\t.globl poses_start', 'poses_start:', '\t.incbin "poses.bin"',
        ...Object.entries(symbols).map(([n, a]) => `\t.globl _${n}\n\t.set _${n}, poses_start + 0x${(a - base).toString(16)}`), '',
    ].join('\n');
    return { base, bytes, symbols, decl: declHeader(h), asm, opt: `-Wl,--section-start=.poses=0x${base.toString(16)}\n` };
}

/* ---- the command line ----------------------------------------------------- */

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
    const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
    const [src, outdir] = process.argv.slice(2);
    if (!src || !outdir) throw new Error('node tools/board/c-data.mjs <poses.h> <outdir>');
    const p = posesData(readFileSync(src, 'utf8'));
    mkdirSync(outdir, { recursive: true });
    const write = (f, d) => {
        /* only when it changed, so make does not relink for nothing */
        try { if (Buffer.from(readFileSync(`${outdir}/${f}`)).equals(Buffer.from(d))) return; } catch {}
        writeFileSync(`${outdir}/${f}`, d);
    };
    write('poses.bin', p.bytes);
    write('poses.s', p.asm);
    write('poses_decl.h', p.decl);
    write('poses.opt', p.opt);
    console.log(`poses: ${p.bytes.length} bytes at 0x${p.base.toString(16)}..0x${POSES_END.toString(16)}, ${Object.keys(p.symbols).length} objects`);
}
