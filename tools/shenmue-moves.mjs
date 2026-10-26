/*
 * A Shenmue fighter's own moves on the board (tools/ryo-guest.mjs): the
 * moves the web roster plays for Ryo and Chai (js/ryo.js readMoves, their
 * motion records), put into the moveset the guest has as a copy of Akira's
 * (tools/vf2-guest.mjs ownMoveset).
 *
 *   - Each motion his moves play, and each motion his throws give their
 *     victim, gets an id of the guest's own: its block converted from
 *     Shenmue's (js/shenmue.js, at Akira's size, scaleMotion), and a setup in
 *     VF2's form that convertSetup turns into StF's. A strike's setup is the
 *     one of Akira's whose strike is nearest it (same level, the same kind of
 *     limb, the nearest damage), with Shenmue's timing (op 2), level, damage
 *     and limb (op 4) in it and its play ops (fists, sounds) moved to the new
 *     frames; a throw's is one of Akira's throws, its victim's that throw's
 *     victim's. StF's fighters play a copy of a victim's motion at their
 *     size (THROWN), as they do Akira's.
 *   - His command scripts: on the ground, P, K, P+K and P+G go to scripts of
 *     his own. Each first hands a downed opponent and anything with the
 *     stick held down to Akira's script for that button (his ground and
 *     crouching moves stay Akira's), then tries the guest's moves in the web
 *     roster's order (its direction tests, newest first, as StF's `exact`
 *     tests), the plain move last. A string's next move is a table of its
 *     own (setpc), whose scripts wait for the cancel frame (op 0x12) as
 *     Akira's do. Throws carry Akira's throw guards (en_flag bit 8, state bit
 *     8 clear); P+G out of reach is his P.
 *
 * What is not his yet: the downed-opponent, crouching and other contexts'
 * moves (Akira's), a throw's own follow-up (Ryo's NGS_HED_2, NGS_SP2/SP3),
 * and moves with no attack record (Chai's drop kick).
 */
import { shenmueFighter } from '../js/ryo.js';
import { sampleMotion } from '../vendor/noclip/js/motion.js';
import { scaleMotion, THROWN } from './vf2-guest.mjs';

const MAIN_DATA = 0x02000000;
const P = 1, K = 2, G = 4;
const FWD = 64, BACK = 128;
/* StF's attack ids for one limb (dword_CE020: a forearm and hand, a shin
 * and foot), by VF2 float object (the limb's IK target, objects 15, 16, 18,
 * 19 as the short-opponent aim pairs them, docs/SHARED-CODE.md) */
const LIMB_ATTACK = [5, 6, 9, 10];
const LIMB_OBJECT = [15, 16, 18, 19];
const ARMS = 0x1f8, LEGS = 0xfc00;
const STRIKE_PARTS = 0x0ce020;
/* setup ops a template keeps (VF2's): op 1 and 0xA name motions to go on
 * to, op 3 is a jump's */
const STRIKE_OPS = new Set([2, 4, 6, 7, 0xb, 0xc, 0xd, 0xe]);
/* play ops a strike keeps: a sound, a voice, a hand shape */
const STRIKE_PLAY = new Set([4, 9, 0x12]);
/* the id convertSetup is told is a throw's victim (no VF2 id: 1360 is the
 * last) */
const VICTIM = 0x1fff;

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];

/* A frame of a template's moved onto a move's: piecewise straight from the
 * template's points (1, hit, cancel, end) to the move's. */
function retime(f, from, to) {
    if (f <= from[0]) return f;
    for (let i = 1; i < from.length; i++) {
        if (f <= from[i] || i === from.length - 1) {
            const a = from[i - 1], b = from[i], s = b > a ? (f - a) / (b - a) : 1;
            return Math.max(1, Math.round(to[i - 1] + s * (to[i] - to[i - 1])));
        }
    }
    return f;
}

/* The limb a strike hits with: the one whose IK target is furthest forward
 * of the body (z) at the hit frame, the button's limbs ahead by 0.3. */
function limbOf(f, m, hit, key) {
    const s = sampleMotion(f.rom, m, hit);
    const z = (obj) => s.targets[(obj - 12) * 3 + 2] - s.targets[2];
    let best = 0, score = -Infinity;
    LIMB_OBJECT.forEach((obj, i) => {
        const arm = i < 2;
        const v = z(obj) + ((key === P && arm) || (key === K && !arm) ? 0.3 : 0);
        if (v > score) { score = v; best = i; }
    });
    return best;
}

export function shenmueMoves(R, ctx, games, { name, who, ms }) {
    const f = shenmueFighter(games, { name });
    const report = [];
    const gid = (x) => {
        if (x === 0xffff) return x;
        const m = x & 0x1fff;
        if (!m) return x;
        if (!ms.ids.has(m)) throw new Error(`${who}: motion ${m} has no id of his`);
        return (x & ~0x1fff) | ms.ids.get(m);
    };

    /* ---- the moves: what each plays ---- */
    const moveOf = new Map();          /* Shenmue id -> {kind, timing, attack, block} */
    const skipped = new Set();
    const move = (id) => {
        if (moveOf.has(id)) return moveOf.get(id);
        const m = f.motion(id), t = f.timing(id), a = f.attack(id);
        const ok = m && t && a && (a.victim == null || f.motion(a.victim));
        moveOf.set(id, ok ? { m, t, a, throw: a.victim != null } : null);
        if (!ok) skipped.add(id);
        return moveOf.get(id);
    };
    /* the ones his scripts reach: the root's on the four buttons, and the
     * strings after a strike (a throw's own follow-up is not his yet) */
    const reached = new Set();
    const reach = (pc, keys) => {
        for (const e of f.moves.tables.get(pc) ?? []) {
            if (keys && !keys.includes(e.key)) continue;
            const x = move(e.motion);
            if (x && !x.throw && e.follow && !reached.has(e.follow)) { reached.add(e.follow); reach(e.follow); }
        }
    };
    reach(f.moves.root, [P, K, P | K, P | G]);

    /* ---- templates: Akira's (VF2) setups ---- */
    const parts = (id) => R.program.u32(STRIKE_PARTS + id * 4);
    const strikes = [], throws = [];
    for (const [id, s] of ctx.setups) {
        const op = (n) => s.setup.find((x) => x.op === n);
        if (op(4) && op(2) && s.head[1] === 1 && s.setup.every((x) => STRIKE_OPS.has(x.op)) && op(4).b[2] <= 2) {
            const b = op(4).b, p = parts(b[1]);
            strikes.push({ id, level: b[2], damage: b[3], arm: !!(p & ARMS), leg: !!(p & LEGS) });
        }
        /* a throw: no strike, op 5 of VF2's 50, op 0xD (Akira's ground throws) */
        if (op(5) && op(2) && op(0xd) && !op(4) && op(5).b[3] === 50) throws.push({ id, s });
    }
    const strikeTemplate = (level, arm, damage) => {
        const by = (list) => list.sort((a, b) => Math.abs(a.damage - damage) - Math.abs(b.damage - damage) || a.id - b.id)[0];
        return by(strikes.filter((x) => x.level === level && (arm ? x.arm : x.leg))) ?? by(strikes.filter((x) => x.level === level)) ?? by(strikes);
    };
    const timingOf = (s) => { const b = s.setup.find((x) => x.op === 2).b; return [b[1] | (b[2] << 8), b[3] | (b[4] << 8), b[5] | (b[6] << 8)]; };
    const throwTemplate = (end) => throws.sort((a, b) => Math.abs(timingOf(a.s)[2] - end) - Math.abs(timingOf(b.s)[2] - end) || a.id - b.id)[0];
    if (!strikes.length || !throws.length) throw new Error(`${who}: no strike or throw of Akira's to build on`);

    /* ---- ids: each move's motion, each throw's victim and its copy ---- */
    const moves = [...moveOf].filter(([, x]) => x);
    const victims = [...new Set(moves.filter(([, x]) => x.throw).map(([, x]) => x.a.victim))];
    const first = ctx.reserveIds(moves.length + 2 * victims.length, who);
    const newId = new Map(moves.map(([id], i) => [id, first + i]));
    const victimId = new Map(victims.map((id, i) => [id, first + moves.length + 2 * i]));
    const blockOf = (m, k) => {
        const b = new Uint8Array(m.view.buffer.slice(m.view.byteOffset, m.view.byteOffset + m.end));
        return scaleMotion(b, k);
    };

    /* ---- motions and setups ---- */
    const keyOf = new Map();
    for (const es of f.moves.tables.values()) for (const e of es) if (!keyOf.has(e.motion)) keyOf.set(e.motion, e.key);
    const victimTemplate = new Map();
    let strikeCount = 0, throwCount = 0;
    const limbs = [0, 0, 0, 0];
    for (const [id, x] of moves) {
        const frames = x.m.frames;
        const end = Math.min(x.t.end, frames), cancel = Math.min(x.t.cancel, end), hit = Math.max(1, Math.min(x.t.hit, cancel));
        const op2 = { op: 2, b: Uint8Array.of(2, ...u16(hit), ...u16(cancel), ...u16(end)) };
        let s, mid = gid;
        if (!x.throw) {
            const limb = limbOf(f, x.m, hit, keyOf.get(id));
            limbs[limb]++;
            const tpl = ctx.setups.get(strikeTemplate(x.a.level, limb < 2, x.a.damage).id);
            const from = [1, ...timingOf(tpl)], to = [1, hit, cancel, end];
            const setup = [];
            for (const o of tpl.setup) {
                if (o.op === 2) setup.push(op2);
                else if (o.op === 4) {
                    const b = Uint8Array.from(o.b);
                    b[1] = LIMB_ATTACK[limb]; b[2] = x.a.level; b[3] = x.a.damage;
                    setup.push({ op: 4, b });
                } else setup.push(o);
            }
            const play = tpl.play.filter((o) => STRIKE_PLAY.has(o.op)).map((o) => {
                const b = Uint8Array.from(o.b), at = retime(b[1] | (b[2] << 8), from, to);
                b[1] = at & 0xff; b[2] = at >> 8;
                return { op: o.op, b };
            }).sort((a, b) => (a.b[1] | (a.b[2] << 8)) - (b.b[1] | (b.b[2] << 8)));
            s = { head: tpl.head, setup, play, end: play.length ? 8 : 0 };
            strikeCount++;
        } else {
            const tpl = throwTemplate(end).s;
            const from = [1, ...timingOf(tpl)], to = [1, hit, cancel, end];
            const setup = tpl.setup.map((o) => {
                if (o.op === 2) return op2;
                if (o.op !== 5) return o;
                const b = Uint8Array.from(o.b);
                b[1] = VICTIM & 0xff; b[2] = VICTIM >> 8;
                victimTemplate.set(x.a.victim, { id: (o.b[1] | (o.b[2] << 8)) & 0x1fff, hit, cancel });
                return { op: 5, b };
            });
            const play = tpl.play.filter((o) => o.op === 4).map((o) => {
                const b = Uint8Array.from(o.b), at = retime(b[1] | (b[2] << 8), from, to);
                b[1] = at & 0xff; b[2] = at >> 8;
                return { op: o.op, b };
            });
            s = { head: tpl.head, setup, play, end: play.length ? 8 : 0 };
            const v = victimId.get(x.a.victim);
            mid = (y) => ((y & 0x1fff) === VICTIM ? (y & ~0x1fff) | v : gid(y));
            throwCount++;
        }
        ctx.putMotion(newId.get(id), blockOf(x.m), ctx.convertSetup(-1, mid, s), who, `${x.m.name ?? id}`);
    }
    /* the victims: the template victim's setup, its play ops over the new frames */
    for (const id of victims) {
        const m = f.motion(id), vt = victimTemplate.get(id), tpl = ctx.setups.get(vt.id);
        const from = [1, ctx.vf2Frames(vt.id)], to = [1, m.frames];
        const play = tpl.play.map((o) => {
            const b = Uint8Array.from(o.b), at = retime(b[1] | (b[2] << 8), from, to);
            b[1] = at & 0xff; b[2] = at >> 8;
            return { op: o.op, b };
        });
        const setup = tpl.setup.filter((o) => o.op !== 2);
        const b = ctx.convertSetup(-1, gid, { head: tpl.head, setup, play, end: tpl.end });
        const own = victimId.get(id), copy = own + 1;
        ctx.putMotion(own, blockOf(m), b, who, `victim ${m.name ?? id}`);
        ctx.putMotion(copy, blockOf(m, THROWN), b, who, `victim ${m.name ?? id} (StF's fighters)`);
        ctx.theirCopy(own, copy);
    }

    /* ---- the command scripts ---- */
    const out = R.main.out;
    const rd32 = (a) => out[a - MAIN_DATA] | (out[a - MAIN_DATA + 1] << 8) | (out[a - MAIN_DATA + 2] << 16) | ((out[a - MAIN_DATA + 3] << 24) >>> 0);
    const akira = new Map();           /* key -> his script, and its header */
    for (let h = ms.root; out[h - MAIN_DATA] === 0x0e; h += 7) {
        const key = out[h - MAIN_DATA + 1] | (out[h - MAIN_DATA + 2] << 8);
        if (!akira.has(key)) akira.set(key, { script: rd32(h + 3) >>> 0, header: h });
    }
    const root = f.moves.tables.get(f.moves.root);
    const keys = [P, K, P | K, P | G].filter((k) => root.some((e) => e.key === k) && akira.has(k));

    const base = (ctx.heapEnd() + 3) & ~3;
    const b = [], labels = new Map(), fixes = [];
    const here = () => base + b.length;
    const at = (l) => { labels.set(l, here()); };
    const addr = (t) => { if (typeof t === 'number') b.push(...u32(t)); else { fixes.push([b.length, t]); b.push(0, 0, 0, 0); } };
    let n = 0;
    const label = () => ({ n: n++ });
    const tables = new Map();          /* follow pc -> label */
    const tableOf = (pc) => { if (!tables.has(pc)) tables.set(pc, label()); return tables.get(pc); };
    let committed = 0;
    /* a run of candidates, then `fallback` if every one fails; the plain
     * press ends the run, so it goes after the stick's (the web's tables
     * hold it among them: Ryo's back moves follow his plain P) */
    const body = (entries, fallback) => {
        const isPlain = (e) => !e.dirs.length && !moveOf.get(e.motion)?.throw;
        for (const e of [...entries.filter((e) => !isPlain(e)), ...entries.filter(isPlain)]) {
            const x = moveOf.get(e.motion);
            if (!x) continue;
            const plain = !e.dirs.length && !x.throw;
            const next = label();
            if (!plain) { b.push(0x0f); addr(next); }
            if (x.throw) b.push(0x07, 8, 0x0b, 8);
            if (e.dirs.length) {
                b.push(0x04, Math.min(0x1c, 6 * e.dirs.length));
                for (const d of e.dirs) b.push(0x01, 0, d.mask === FWD ? 1 : d.mask === BACK ? 2 : 0);
            }
            if (e.follow && !x.throw) { b.push(0x0d); addr(tableOf(e.follow)); }
            b.push(0x05, ...u32(((x.throw ? 12 : 0) << 24 | newId.get(e.motion)) >>> 0), 0, 0, 0, 0);
            committed++;
            if (plain) return;
            at(next);
        }
        fallback();
    };
    const scripts = new Map();
    for (const k of keys) {
        const his = akira.get(k).script, l1 = label(), l2 = label();
        const start = label(), own = label();
        scripts.set(k, own);
        at(start);
        /* a downed opponent: his (what follows his script's alt2 and en_set 0) */
        b.push(0x0f); addr(l1); b.push(0x07, 0, 0x11); addr(his + 7);
        /* the stick held down: his */
        at(l1); b.push(0x0f); addr(l2); b.push(0x02, 4, 0x11); addr(his);
        at(l2); at(own);
        akira.get(k).start = start;
        body(root.filter((e) => e.key === k), () => {
            b.push(0x11);
            addr(k === (P | G) && scripts.has(P) ? scripts.get(P) : his);
        });
    }
    /* the strings' tables: a header a button, its script waiting for the cancel frame */
    for (let done = 0; done < tables.size;) {
        const [pc, l] = [...tables][done++];
        const es = f.moves.tables.get(pc) ?? [];
        const ks = [...new Set(es.filter((e) => moveOf.get(e.motion)).map((e) => e.key))];
        at(l);
        const ls = ks.map(() => label());
        ks.forEach((k, i) => { b.push(0x0e, ...u16(k)); addr(ls[i]); });
        b.push(0);
        ks.forEach((k, i) => {
            at(ls[i]);
            b.push(0x12, 0x0a, 0x08, 0x00);
            body(es.filter((e) => e.key === k), () => b.push(0x10));
        });
    }
    for (const [o, l] of fixes) b.splice(o, 4, ...u32(labels.get(l)));
    const prog = Uint8Array.from(b);
    if (ctx.alloc(prog, 'own command scripts', 4, who) !== base) throw new Error(`${who}: command scripts moved`);
    for (const k of keys) R.main.put(akira.get(k).header + 3 - MAIN_DATA, Uint8Array.from(u32(labels.get(akira.get(k).start))), `${who} root header`);

    const spell = (k) => [k & K ? 'K' : '', k & P ? 'P' : '', k & G ? 'G' : ''].filter(Boolean).join('+');
    report.push(`own moves: ${strikeCount} strikes, ${throwCount} throws, ${victims.length} victims' motions (and StF's fighters' copies) as ${first}..${first + moves.length + 2 * victims.length - 1}; ` +
        `limbs ${limbs.join('/')} (left/right arm, left/right leg); ${skipped.size ? `skipped ${[...skipped].map((id) => f.motion(id)?.name ?? id).join(', ')}; ` : ''}` +
        `blocks to 0x${(MAIN_DATA + ctx.ownBlocksEnd()).toString(16).toUpperCase()}; scripts for ${keys.map(spell).join(', ')} and ${tables.size} string tables at ${'0x' + base.toString(16).toUpperCase()}, ${prog.length} bytes, ${committed} commits`);
    const names = [...moves.map(([, x]) => x.m.name), ...victims.flatMap((id) => [f.motion(id).name, `${f.motion(id).name} (StF's fighters)`])];
    return { report, first, names, count: moves.length + 2 * victims.length, strikes: strikeCount, throws: throwCount, victims: victims.length, tables: tables.size, keys: keys.map(spell) };
}
