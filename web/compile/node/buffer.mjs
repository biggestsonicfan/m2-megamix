/*
 * Node's Buffer, as much of it as the tools use (tools/sources/fm-saturn.mjs,
 * tools/guests/fm-moves.mjs, tools/stages/doa-stages.mjs): a Uint8Array with
 * Node's readers and writers, and slice() a view as Node's is.
 */
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };

export class Buffer extends Uint8Array {
    static alloc(n, fill = 0) { const b = new Buffer(n); if (fill) b.fill(fill); return b; }
    static allocUnsafe(n) { return new Buffer(n); }
    static isBuffer(x) { return x instanceof Buffer; }
    static byteLength(s) { return new TextEncoder().encode(s).length; }
    /* A string, an array, a copy of a typed array, or a view of an ArrayBuffer (as Node's). */
    static from(x, a, b) {
        if (typeof x === 'string') {
            if (a === 'hex') return new Buffer(x.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
            if (a === 'latin1' || a === 'binary' || a === 'ascii') return new Buffer(Array.from(x, (c) => c.charCodeAt(0) & 0xff));
            if (a === 'base64') return Buffer.from(atob(x), 'latin1');
            const e = new TextEncoder().encode(x);
            return new Buffer(e.buffer, e.byteOffset, e.length);
        }
        if (x instanceof ArrayBuffer) return new Buffer(x, a ?? 0, b ?? x.byteLength - (a ?? 0));
        if (ArrayBuffer.isView(x)) { const o = new Buffer(x.byteLength); o.set(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)); return o; }
        return new Buffer(x);
    }
    static concat(list, total) {
        total ??= list.reduce((n, b) => n + b.length, 0);
        const o = new Buffer(total);
        let at = 0;
        for (const b of list) { o.set(b.subarray(0, total - at), at); at += Math.min(b.length, total - at); }
        return o;
    }
    static get [Symbol.species]() { return Buffer; }

    slice(s, e) { return this.subarray(s, e); }
    toString(enc = 'utf8', s = 0, e = this.length) {
        const b = this.subarray(s, e);
        if (enc === 'hex') return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
        if (enc === 'latin1' || enc === 'binary') return latin1(b);
        if (enc === 'ascii') return latin1(b.map((x) => x & 0x7f));
        if (enc === 'base64') return btoa(latin1(b));
        return new TextDecoder().decode(b);
    }
    equals(o) { return this.length === o.length && this.every((x, i) => x === o[i]); }
    copy(t, ts = 0, s = 0, e = this.length) { const p = this.subarray(s, e); t.set(p, ts); return p.length; }
    write(str, off = 0, enc = 'utf8') { const b = Buffer.from(str, enc); this.set(b.subarray(0, this.length - off), off); return Math.min(b.length, this.length - off); }

    readUInt8(o = 0) { return this[o]; }
    readInt8(o = 0) { return dv(this).getInt8(o); }
    readUInt16LE(o = 0) { return dv(this).getUint16(o, true); }
    readUInt16BE(o = 0) { return dv(this).getUint16(o); }
    readInt16LE(o = 0) { return dv(this).getInt16(o, true); }
    readInt16BE(o = 0) { return dv(this).getInt16(o); }
    readUInt32LE(o = 0) { return dv(this).getUint32(o, true); }
    readUInt32BE(o = 0) { return dv(this).getUint32(o); }
    readInt32LE(o = 0) { return dv(this).getInt32(o, true); }
    readInt32BE(o = 0) { return dv(this).getInt32(o); }
    readFloatLE(o = 0) { return dv(this).getFloat32(o, true); }
    readFloatBE(o = 0) { return dv(this).getFloat32(o); }
    writeUInt8(v, o = 0) { this[o] = v; return o + 1; }
    writeUInt16LE(v, o = 0) { dv(this).setUint16(o, v, true); return o + 2; }
    writeUInt16BE(v, o = 0) { dv(this).setUint16(o, v); return o + 2; }
    writeUInt32LE(v, o = 0) { dv(this).setUint32(o, v, true); return o + 4; }
    writeUInt32BE(v, o = 0) { dv(this).setUint32(o, v); return o + 4; }
    writeInt32LE(v, o = 0) { dv(this).setInt32(o, v, true); return o + 4; }
    writeInt32BE(v, o = 0) { dv(this).setInt32(o, v); return o + 4; }
    writeFloatLE(v, o = 0) { dv(this).setFloat32(o, v, true); return o + 4; }
    writeFloatBE(v, o = 0) { dv(this).setFloat32(o, v); return o + 4; }
}
/* the aliases Node has */
for (const [a, b] of [['readUint8', 'readUInt8'], ['readUint16LE', 'readUInt16LE'], ['readUint16BE', 'readUInt16BE'],
    ['readUint32LE', 'readUInt32LE'], ['readUint32BE', 'readUInt32BE']]) Buffer.prototype[a] = Buffer.prototype[b];

export default { Buffer };
