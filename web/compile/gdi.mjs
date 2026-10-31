/*
 * A file off a GD-ROM dump (.gdi and its tracks), as tools/sources/shenmue-fight.py
 * reads one: the high-density area's data tracks (type 4, from LBA 45000),
 * 2048-byte sectors, an ISO 9660 volume at LBA 45016. `read(name, offset, n)`
 * reads a track file named in the .gdi.
 */
export function openGdi(gdiText, read) {
    const tracks = [];
    for (const line of gdiText.split(/\r?\n/).slice(1)) {
        /* a track's name may be quoted, with spaces */
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+("[^"]+"|\S+)/);
        if (!m || m[3] !== '4' || +m[2] < 45000) continue;
        if (m[4] !== '2048') throw new Error('gdi: only 2048-byte data tracks are handled');
        tracks.push({ lba: +m[2], name: m[5].replace(/^"|"$/g, '') });
    }
    if (!tracks.length) throw new Error('gdi: no high-density data track');
    const sectors = (lba, n) => {
        const out = new Uint8Array(n);
        let at = 0;
        while (at < n) {
            const t = tracks.filter((x) => lba >= x.lba).reduce((a, b) => (b.lba > a.lba ? b : a));
            const chunk = read(t.name, (lba - t.lba) * 2048, Math.min(n - at, 2048 * 1024));
            if (!chunk.length) throw new Error(`gdi: short read at LBA ${lba}`);
            out.set(chunk, at);
            at += chunk.length;
            lba += chunk.length / 2048;
        }
        return out;
    };
    const pvd = sectors(45016, 2048);
    if (String.fromCharCode(...pvd.subarray(1, 6)) !== 'CD001') throw new Error('gdi: no ISO 9660 volume at LBA 45016');
    const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
    const dir = new Map();                  /* "/MISC/COLD.BIN" -> [lba, size] */
    const walk = (lba, size, path) => {
        const d = sectors(lba, Math.ceil(size / 2048) * 2048);
        for (let i = 0; i < size;) {
            const n = d[i];
            if (n === 0) { i = (Math.floor(i / 2048) + 1) * 2048; continue; }
            const ext = u32(d, i + 2), sz = u32(d, i + 10), flags = d[i + 25];
            const name = String.fromCharCode(...d.subarray(i + 33, i + 33 + d[i + 32]));
            i += n;
            if (name === '\0' || name === '\x01') continue;
            const p = `${path}/${name.split(';')[0]}`;
            if (flags & 2) walk(ext, sz, p); else dir.set(p.toUpperCase(), [ext, sz]);
        }
    };
    walk(u32(pvd, 156 + 2), u32(pvd, 156 + 10), '');
    return {
        /* one file's bytes by its path on the disc (MISC/MOTION.BIN), or null */
        file(path) {
            const e = dir.get('/' + path.replace(/^\/+/, '').toUpperCase());
            return e ? sectors(e[0], Math.ceil(e[1] / 2048) * 2048).slice(0, e[1]) : null;
        },
    };
}
