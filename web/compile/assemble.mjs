/*
 * The board's program EPROMs from a kit (tools/web/make-kit.mjs) and the
 * player's own Sonic the Fighters, and the set as one zip. Shared by the kit
 * maker (Node), which checks the round trip, and the compiler (the browser).
 *
 * A kit's program image holds the board's own code as it is, and nothing of
 * StF's: the code lifted from StF's program (tools/board/lift-stf.py) and the
 * copy of its ROM tables (.stfrom) are kept XORed with the StF words they came
 * from (kit.xor: [dst, length, src] runs), and the poses' range
 * (tools/board/c-data.mjs) is zeros, made again from the player's ROMs.
 */

/* A ROM_LOAD32_WORD pair: the first file holds bytes 0-1 of each 32-bit word, the second 2-3. */
export function merge32(a, b) {
    const o = new Uint8Array(a.length * 2);
    for (let i = 0; i < a.length; i += 2) {
        o[2 * i] = a[i]; o[2 * i + 1] = a[i + 1];
        o[2 * i + 2] = b[i]; o[2 * i + 3] = b[i + 1];
    }
    return o;
}
export function split32(img) {
    const a = new Uint8Array(img.length / 2), b = new Uint8Array(img.length / 2);
    for (let i = 0; i < img.length; i += 4) {
        a[i / 2] = img[i]; a[i / 2 + 1] = img[i + 1];
        b[i / 2] = img[i + 2]; b[i / 2 + 1] = img[i + 3];
    }
    return [a, b];
}

/* The program image: the kit's, StF's words XORed back in, the poses written. */
export function program(kit, image, stf, poses) {
    const out = Uint8Array.from(image);
    for (const [dst, n, src] of kit.xor)
        for (let i = 0; i < n; i++) out[dst + i] ^= stf[src + i];
    if (poses.length !== kit.poses.size) throw new Error(`poses: ${poses.length} bytes, the kit's are ${kit.poses.size}`);
    out.set(poses, kit.poses.base);
    return out;
}

/* ---- the zip: stored, in name order, with no dates, so the same files make the same bytes */

const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
});
export function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export function storeZip(entries) {
    entries = [...entries].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    const enc = new TextEncoder();
    const parts = [], central = [];
    let at = 0;
    for (const e of entries) {
        const name = enc.encode(e.name), crc = crc32(e.data), n = e.data.length;
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0, true);
        h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);   /* 1980-01-01 */
        h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true);
        h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
        c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
        c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true);
        c.setUint16(28, name.length, true); c.setUint32(42, at, true);
        central.push(new Uint8Array(c.buffer), name);
        parts.push(new Uint8Array(h.buffer), name, e.data);
        at += 30 + name.length + n;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, at, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
}

export async function sha256(b) {
    const d = await crypto.subtle.digest('SHA-256', b);
    return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}
