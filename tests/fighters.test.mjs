/* Every fighter loads, poses its actions, and reads its moves and attacks;
 * one game's throw victim motion poses on another game's body. */
import assert from 'node:assert/strict';
import { loadNodeGames } from './node-roms.mjs';
import { ROSTER } from '../js/games.js';
import { makeFighter } from '../js/fighters.js';

const games = await loadNodeGames();
const fighters = ROSTER.map((e) => makeFighter(games, e));
const ACTS = ['stance', 'crouch', 'guard', 'walkF', 'walkB', 'dashF', 'jump', 'down', 'rise'];

for (const f of fighters) {
    const body = f.createBody();
    for (const a of ACTS) {
        const ref = f.act(a);
        assert.ok(ref.motion, `${f.name} ${a}`);
        const p = body.pose(ref, 1);
        assert.equal(p.mats.length, 16);
        /* Ryo's model is one skin over the sixteen slots; the rest are parts. */
        if (p.parts[0]?.skin) assert.ok(p.parts[0].skin.positions.length === body.skin.count * 3, `${f.name} ${a} skin`);
        else assert.ok(p.parts.length >= 10, `${f.name} ${a} parts ${p.parts.length}`);
        for (const part of p.parts) if (part.key != null) assert.ok(body.decode(part.key), `${f.name} model ${part.key}`);
    }
    const entries = f.moves.tables.get(f.moves.root);
    const strikes = [], throws = [];
    for (const e of entries) {
        const a = f.attack(e.motion & 0x1fff);
        if (a?.victim != null) throws.push(e.motion & 0x1fff); else if (a) strikes.push(a);
    }
    const head = f.act('stance').motion;
    const top = head.frames;
    const y = p0(body, f, head);
    console.log(f.game, f.name.padEnd(7), 'root entries', entries.length, 'strikes', strikes.length, 'throws', throws.length,
        'stance frames', top, 'head y', y.toFixed(2),
        'dmg', strikes.slice(0, 6).map((a) => `${a.level ?? '?'}:${a.damage}`).join(' '));
    assert.ok(strikes.length > 3, `${f.name} strikes`);
}

function p0(body, f, motion) {
    return body.pose({ rom: f.rom, motion }, 1).mats[2][13];
}

/* Cross-game: Akira's first throw on Sonic, Sonic's on Mahler. */
for (const [a, v] of [[0, 6], [6, 5], [3, 8]]) {
    const att = fighters[a], vic = fighters[v];
    const entry = [...att.moves.tables.values()].flat().find((e) => att.attack(e.motion & 0x1fff)?.victim != null);
    assert.ok(entry, `${att.name} has a throw`);
    const victim = att.attack(entry.motion & 0x1fff).victim;
    const body = vic.createBody();
    const ref = { rom: att.rom, motion: (await import('../js/fighters.js')).motionOf(att.rom, victim) };
    assert.ok(ref.motion, 'victim motion decodes');
    const p = body.pose(ref, Math.floor(ref.motion.frames / 2));
    assert.ok(p.mats.every((m) => m.every(Number.isFinite)));
    console.log('throw', att.name, '->', vic.name, 'victim motion', victim, 'frames', ref.motion.frames);
}

/* Reactions across games. */
for (const [a, v] of [[0, 3], [6, 0], [3, 6], [3, 4]]) {
    const att = fighters[a], vic = fighters[v];
    const entry = f0(att);
    const at = { ...att.attack(entry), game: att.game, level: 1 };
    for (const how of ['hit', 'guard', 'down']) {
        const r = vic.reaction(at, how);
        assert.ok(r?.motion, `${vic.name} ${how} reaction to ${att.name}`);
    }
}
function f0(f) {
    return [...f.moves.tables.get(f.moves.root)].map((e) => e.motion & 0x1fff).find((id) => f.attack(id)?.level !== undefined && f.attack(id)?.victim == null);
}
/* Ryo (with the Shenmue disc): 5'9" to Akira's 5'11", and his throw on Akira. */
const ryo = fighters.find((f) => f.name === 'RYO');
if (ryo) {
    const { ryoFit, SIZE } = await import('../js/ryo.js');
    const fit = ryoFit(games);
    assert.ok(Math.abs(fit.ryo / fit.akira - 69 / 71) < 0.002, `Ryo's height ${fit.ryo} to Akira's ${fit.akira}`);
    assert.equal(ryo.size, SIZE);
    const entry = [...ryo.moves.tables.values()].flat().find((e) => ryo.attack(e.motion)?.victim != null);
    assert.ok(entry, 'Ryo has a throw');
    const ref = { rom: ryo.rom, motion: ryo.motion(ryo.attack(entry.motion).victim) };
    const p = fighters[0].createBody().pose(ref, Math.floor(ref.motion.frames / 2));
    assert.ok(p.mats.every((m) => m.every(Number.isFinite)));
    console.log('Ryo', fit.ryo.toFixed(3), 'to Akira', fit.akira.toFixed(3), 'throw', entry.name);
} else console.log('Ryo skipped: no Shenmue disc');
/* Chai (disc 3's ending fight): his own bank and script, sized by his model
 * to Ryo's, his throws and strikes his. */
const chai = fighters.find((f) => f.name === 'CHAI');
if (chai) {
    const { shenmueFit, SIZE, restHeight } = await import('../js/ryo.js');
    const c = games.shenmue.chars.CHAI;
    const fit = shenmueFit(games, c);
    const want = SIZE * restHeight(c.fullModel) / restHeight(games.shenmue.chars.RYO.model);
    assert.ok(Math.abs(fit.ryo / fit.akira - want) < 0.002, `Chai's height ${fit.ryo} to Akira's ${fit.akira}`);
    const all = [...chai.moves.tables.values()].flat();
    const own = all.filter((e) => (e.motion & 0x1fff) >= c.bank.base);
    assert.ok(own.length > 10, `Chai's moves from his bank: ${own.length}`);
    const throws = all.filter((e) => chai.attack(e.motion)?.victim != null);
    assert.ok(throws.length, 'Chai has a throw');
    const ref = { rom: chai.rom, motion: chai.motion(chai.attack(throws[0].motion).victim) };
    assert.ok(ref.motion, 'his throw\'s victim motion');
    const p = fighters[0].createBody().pose(ref, Math.floor(ref.motion.frames / 2));
    assert.ok(p.mats.every((m) => m.every(Number.isFinite)));
    assert.equal(chai.act('stance').motion.id, 0x800);
    const b = chai.createBody().pose(chai.act('stance'), 0);
    assert.ok(b.mats.every((m) => m.every(Number.isFinite)));
    console.log('Chai', fit.ryo.toFixed(3), 'to Akira', fit.akira.toFixed(3), 'moves', all.length, 'his own', own.length,
        'throws', throws.map((e) => e.name).join(' '));
} else console.log('Chai skipped: no Shenmue disc');
console.log('ok');

/* The rules the setup records carry: a throw's damage (op 5) and the
 * victim motion's own hits (play op 8), each strike's attack part as a slot
 * mask and its level (op 4), and the down attacks' entries, which the
 * matcher takes in a jump's context with the other lying down. */
{
    const { matchPress, P, HIGH, MID, LOW } = await import('../js/fighters.js');
    const named = (n, g) => fighters.find((f) => f.name === n && f.game === g);
    const akira = named('AKIRA', 'vf2');
    assert.deepEqual(akira.attack(15), { victim: 16, damage: 20, hits: [{ frame: 47, damage: 10 }, { frame: 62, damage: 10 }] }, 'Akira 15 throws 16');
    for (const g of ['vf2', 'fv', 'stf']) {
        const strikes = fighters.filter((f) => f.game === g).flatMap((f) => [...f.moves.tables.values()].flat()
            .map((e) => f.attack(e.motion & 0x1fff)).filter((a) => a && a.victim == null));
        assert.ok(strikes.every((a) => a.part === 0 || a.mask), `${g}: every part has slots`);
        assert.ok(strikes.some((a) => a.part === 41 && a.mask === 0xffff) || g !== 'stf', `${g}: part 41 the whole body`);
        assert.ok(strikes.some((a) => a.down), `${g}: down attacks`);
        assert.deepEqual([HIGH, MID, LOW].map((l) => strikes.some((a) => a.level === l)), [true, true, g !== 'stf'], `${g}: levels`);
    }
    const picky = named('PICKY', 'fv');
    const root = picky.moves.tables.get(picky.moves.root);
    assert.equal(matchPress(root, P, [0], 1, { ctx: 1, en: 1 << 5 })?.motion & 0x1fff, 88, 'Picky pounces on a fighter down');
    assert.notEqual(matchPress(root, P, [0], 1, { ctx: 1 })?.motion & 0x1fff, 88, 'and not on one standing');
    assert.ok(picky.attack(88).down, 'DAT_MUNE_MISS is a down attack');
    console.log('rules: Akira 15', JSON.stringify(akira.attack(15)), 'Picky 88 part', picky.attack(88).part, picky.attack(88).mask.toString(16));
}

/* en_down_attack (fighters.js enFlag), as get_en_info sets it from the
 * other's mot_kind: on the knock-down's fall as well as the lying, not while
 * this fighter is in the air over a fall, not on a stance, nor on StF's and
 * FV's rise (mk_rise). Bit 5 in StF and FV (Sonic's down, K: 46), 11 in VF2,
 * where Akira's pounce (567, the small jump's P) wants it. */
{
    const { matchPress, enFlag, P, K, DOWN } = await import('../js/fighters.js');
    for (const g of ['vf2', 'fv', 'stf']) {
        const f = fighters.find((x) => x.game === g);
        const bit = 1 << (g === 'vf2' ? 11 : 5);
        const kindOf = (ref) => f.motKind(ref.motion.index);
        const fall = f.reaction({ game: g, kind: 0, side: 0, level: 1, damage: 30 }, 'down');
        assert.equal(enFlag(g, { kind: kindOf(fall) }), bit, `${g}: set on the fall`);
        assert.equal(enFlag(g, { kind: kindOf(fall), inAir: true }), 0, `${g}: not from the air`);
        assert.equal(enFlag(g, { kind: kindOf(f.act('down')), inAir: true }), bit, `${g}: set on the lying`);
        assert.equal(enFlag(g, { kind: kindOf(f.act('stance')) }), 0, `${g}: not on a stance`);
        if (g !== 'vf2') assert.equal(enFlag(g, { kind: kindOf(f.act('rise')) }), 0, `${g}: not on the rise`);
    }
    assert.equal(enFlag('shenmue', { kind: null, lying: true }), 1 << 5, 'no motd_kind: lying stands in');
    const akira = fighters.find((f) => f.name === 'AKIRA' && f.game === 'vf2');
    const root = akira.moves.tables.get(akira.moves.root);
    assert.equal(matchPress(root, P, [0], 1, { ctx: 2, en: 1 << 11 })?.motion & 0x1fff, 567, 'Akira pounces on bit 11');
    assert.notEqual(matchPress(root, P, [0], 1, { ctx: 2, en: 1 << 5 })?.motion & 0x1fff, 567, 'not on bit 5');
    const sonic = fighters.find((f) => f.name === 'SONIC' && f.game === 'stf');
    const sroot = sonic.moves.tables.get(sonic.moves.root);
    assert.equal(matchPress(sroot, K, [0, DOWN, 0], 1, { en: 1 << 5 })?.motion & 0x1fff, 46, 'Sonic: down, K on bit 5');
    assert.notEqual(matchPress(sroot, K, [0, DOWN, 0], 1, {})?.motion & 0x1fff, 46, 'and not without it');
    /* In a fight: the other is knocked down and still falling; a jump with
     * P pressed before take-off pounces (Picky's 88 in the jump, Akira's 567
     * in the small jump). The engine had it only once the other lay. */
    const { createFight, stepFight, setMotion, ST } = await import('../js/engine.js');
    for (const [n, g, small, want] of [['PICKY', 'fv', false, 88], ['AKIRA', 'vf2', true, 567]]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        const fight = createFight(f, f, f.game);
        fight.phase = 'fight';
        const [p, o] = fight.players;
        setMotion(o, f.reaction({ game: g, kind: 0, side: 0, level: 1, damage: 30 }, 'down'), { state: ST.YARARE });
        o.knocked = true;
        let m = null;
        for (let t = 1; t <= 40 && !m; t++) {
            stepFight(fight, [{ up: small ? t === 1 : t <= 20, P: t === 2 }, {}]);
            m = fight.events.find((e) => e.kind === 'move' && e.side === 0) ?? null;
            assert.equal(o.state, ST.YARARE, `${n}: the other still falling at ${t}`);
        }
        assert.equal(m?.id, want, `${n}: pounces on the fall ${JSON.stringify(m)}`);
    }
    console.log('en_down_attack: on the fall and the lying, bit 11 in VF2');
}

/* The small jump: up let go before take-off commits it (VF2 0x1C3CC), and a
 * kick in it is matched in context 2 or 4, the big jump's in 1 or 3. */
{
    const { createFight, stepFight } = await import('../js/engine.js');
    const { K } = await import('../js/fighters.js');
    const kickIn = (f, upFrames) => {
        const fight = createFight(f, f, f.game);
        fight.phase = 'fight';
        for (let t = 1; t <= 30; t++) {
            stepFight(fight, [{ up: t <= upFrames, K: t === 3 }, {}]);
            const m = fight.events.find((e) => e.kind === 'move' && e.side === 0);
            if (m) {
                const ctx = f.moves.tables.get(f.moves.root)
                    .filter((e) => (e.key & 0xff) === K && (e.motion & 0x1fff) === m.id).map((e) => e.key >> 8);
                return { id: m.id, ctx, small: fight.players[0].small };
            }
        }
        return null;
    };
    for (const [n, g] of [['AKIRA', 'vf2'], ['PICKY', 'fv'], ['SONIC', 'stf']]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        const small = kickIn(f, 1), big = kickIn(f, 30);
        assert.ok(small?.small && small.ctx.length && small.ctx.every((c) => c === 2 || c === 4), `${n}: a small jump kick ${JSON.stringify(small)}`);
        assert.ok(big && !big.small && big.ctx.length && big.ctx.every((c) => c === 1 || c === 3), `${n}: a big jump kick ${JSON.stringify(big)}`);
        console.log('jumps:', n, 'small', small.id, small.ctx, 'big', big.id, big.ctx);
    }
}

/* StF's air step: its jump flies by gravity from take-off (ACT_RC_JUMP
 * 0x13DB8), and a punch in the flight is matched in context 3 (0x1DFEC),
 * the attack played on in the air till the flight lands. */
{
    const { createFight, stepFight } = await import('../js/engine.js');
    const { P } = await import('../js/fighters.js');
    const sonic = fighters.find((x) => x.name === 'SONIC' && x.game === 'stf');
    const t0 = sonic.takeoff(sonic.act('jump').motion.index), n = sonic.flight(false);
    assert.ok(t0 > 0 && n > 0, `SONIC: take-off ${t0}, flight ${n}`);
    const fight = createFight(sonic, sonic, 'stf');
    fight.phase = 'fight';
    const p = fight.players[0];
    let m = null, top = 0, landed = null;
    for (let t = 1; t <= 120; t++) {
        stepFight(fight, [{ up: t <= 30, P: t === t0 + 8 }, {}]);
        top = Math.max(top, p.pos[1]);
        const e = fight.events.find((x) => x.kind === 'move' && x.side === 0);
        if (e) m = { ...e, t, y: p.pos[1], fly: !!p.fly };
        if (m && landed == null && !p.fly) landed = t;
    }
    const ctx = sonic.moves.tables.get(sonic.moves.root)
        .filter((e) => (e.key & 0xff) === P && (e.motion & 0x1fff) === m?.id).map((e) => e.key >> 8);
    assert.ok(m && m.fly && m.y > 0, `SONIC: a punch in the air ${JSON.stringify(m)}`);
    assert.deepEqual(ctx, ctx.length ? ctx.map(() => 3) : [3], `SONIC: matched in context 3 ${JSON.stringify(ctx)}`);
    assert.ok(landed && Math.abs(landed - (t0 + n)) <= 1 && p.pos[1] === 0, `SONIC: lands ${n} frames on (${landed})`);
    console.log('air step: SONIC', m.id, 'ctx', ctx, 'at', m.t, 'y', m.y.toFixed(2), 'top', top.toFixed(2), 'landed', landed);
}

/* An air attack held back: a command with bit 19 (StF 0x133C8, FV 0x13600,
 * VF2 0x14914) waits in the jump till the frames left in the air (+0x5BC)
 * are down to its motion's op 3 hold (+0x5C0), then the jump handler plays
 * it (StF 0x1410C, FV 0x14548, VF2 0x155CC). A small jump's kick (Akira's
 * punch: his kick there, 41, is not held), pressed just after take-off. */
{
    const { createFight, stepFight } = await import('../js/engine.js');
    const { P, K } = await import('../js/fighters.js');
    for (const [n, g, btn] of [['SONIC', 'stf', 'K'], ['PICKY', 'fv', 'K'], ['AKIRA', 'vf2', 'P']]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        const fight = createFight(f, f, f.game);
        fight.phase = 'fight';
        const p = fight.players[0];
        let t0 = null, pressAt = null, m = null, held = null;
        for (let t = 1; t <= 80 && !m; t++) {
            const kick = t0 != null && pressAt == null;
            if (kick) pressAt = t;
            stepFight(fight, [{ up: t === 1, [btn]: kick }, {}]);
            if (t0 == null && p.air != null) t0 = t;
            held ??= p.held && { ...p.held, t };
            m = fight.events.find((e) => e.kind === 'move' && e.side === 0) ?? null;
            if (m) m = { ...m, t };
        }
        assert.ok(held && m && m.id === (held.e.motion & 0x1fff), `${n}: a kick held back ${JSON.stringify({ held, m })}`);
        assert.ok(held.e.cmd & 1 << 19 && held.e.key === (4 << 8 | { P, K }[btn]), `${n}: bit 19, context 4 ${held.e.cmd.toString(16)}`);
        const n0 = f.flight(true);
        assert.equal(m.t - t0, n0 - held.at, `${n}: out with ${held.at} of ${n0} frames left (press ${pressAt - t0}, out ${m.t - t0})`);
        console.log('air hold:', n, btn, 'motion', m.id, 'pressed', pressAt - t0, 'held from', held.t - t0, 'out at', m.t - t0, `(${held.at} of ${n0} left)`);
    }
}

/* Attacks while getting up: VF2's kick while lying picks the rise's get-up
 * kick (down held: the low one), played as soon as the lying is out; FV's
 * and StF's P or K held in the rise's window ends it into the ground
 * table's move, before the rise has run out. */
{
    const { createFight, stepFight } = await import('../js/engine.js');
    const getUp = (f, pad) => {
        const fight = createFight(f, f, f.game);
        fight.phase = 'fight';
        const p = fight.players[0];
        p.energy = 100;
        stepFight(fight, [{}, {}]);
        p.action = 'down'; p.state = 8; p.mot = f.act('down'); p.mot_coma = 1; p.loop = true; p.downFor = 0;
        let riseAt = null;
        for (let t = 1; t <= 150; t++) {
            if (riseAt == null && p.action === 'rise') riseAt = t;
            stepFight(fight, [pad(t, p), {}]);
            const m = fight.events.find((e) => e.kind === 'move' && e.side === 0);
            if (m) return { ...m, t, riseAt, attack: p.attack, action: p.action };
        }
        return null;
    };
    const akira = fighters.find((x) => x.name === 'AKIRA' && x.game === 'vf2');
    const mid = getUp(akira, (t) => ({ K: t === 5 }));
    const low = getUp(akira, (t) => ({ down: t >= 3 && t <= 6, K: t === 5 }));
    assert.equal(mid?.id, akira.act('riseKick').motion.index, `AKIRA: a get-up kick ${JSON.stringify(mid)}`);
    assert.ok(mid.riseAt == null && mid.attack?.damage && mid.t < 50, 'from lying, with its strike');
    assert.equal(low?.id, akira.act('riseLow').motion.index, `AKIRA: a low get-up kick ${JSON.stringify(low)}`);
    console.log('get-up:', 'AKIRA', mid.id, 'level', mid.attack.level, 'low', low.id, 'level', low.attack.level, 'at', mid.t);
    for (const [n, g] of [['PICKY', 'fv'], ['SONIC', 'stf']]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        const rise = f.act('rise').motion, w = f.riseWindow(rise.index);
        const m = getUp(f, (t, p) => ({ K: p.action === 'rise' && w.cancel - p.mot_coma <= w.window }));
        assert.ok(m && m.riseAt != null && m.t - m.riseAt < rise.frames, `${n}: a move out of the rise ${JSON.stringify(m)} ${JSON.stringify(w)}`);
        assert.ok(f.moves.tables.get(f.moves.root).some((e) => (e.motion & 0x1fff) === m.id && e.key >> 8 === 0), `${n}: the ground table's`);
        console.log('get-up:', n, m.name, m.id, 'at rise frame', m.t - m.riseAt, 'of', rise.frames, JSON.stringify(w));
    }
}

/* A counter: attack_hit counts one on a fighter whose mot_kind has
 * mk_attack, which every strike's motd_kind carries and play_motion clears
 * at follow1 (+0x80A), so to the strike's cancel, not its hit frame; VF2
 * and FV deal d * 3 >> 1, StF (d + own >> 2) * 3 >> 1 on its own scale. */
{
    const { isCounter, counterDamage, MK_ATTACK } = await import('../js/fighters.js');
    for (const g of ['vf2', 'fv', 'stf']) {
        const ids = fighters.filter((f) => f.game === g).flatMap((f) => [...f.moves.tables.values()].flat()
            .map((e) => [f, e.motion & 0x1fff]).filter(([f, id]) => { const a = f.attack(id); return a && a.victim == null; }));
        assert.ok(ids.length > 100 && ids.every(([f, id]) => f.motKind(id) & MK_ATTACK), `${g}: every strike has mk_attack`);
    }
    const t = { hit: 10, cancel: 20, end: 30 };
    assert.ok(isCounter(MK_ATTACK, 1, t) && isCounter(MK_ATTACK, 19, t), 'from the first frame to the one before the cancel');
    assert.ok(!isCounter(MK_ATTACK, 20, t) && !isCounter(0, 5, t), 'not from the cancel, nor without mk_attack');
    assert.ok(isCounter(null, 12, t), 'no mot_kind (Shenmue): its moves count');
    assert.equal(counterDamage('vf2', { damage: 25 }), 37);
    assert.equal(counterDamage('fv', { damage: 30 }), 45);
    assert.equal(counterDamage('stf', { damage: 14, raw: 10 }, 10), 26, 'StF: (10 + 2) * 3 >> 1 = 18 of 140');
    /* In a fight: the other's own punch is past its hit frame, before its
     * cancel; a punch on it is a counter (the engine had it only before the
     * hit frame). */
    const { createFight, stepFight, setMotion, bodyPoint, ST } = await import('../js/engine.js');
    const { motionOf } = await import('../js/fighters.js');
    for (const [n, g] of [['AKIRA', 'vf2'], ['PICKY', 'fv'], ['SONIC', 'stf']]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        const fight = createFight(f, f, f.game);
        fight.phase = 'fight';
        const [p, o] = fight.players;
        /* the other plays its first strike with frames between hit and cancel */
        const id = [...new Set(f.moves.tables.get(f.moves.root).map((e) => e.motion & 0x1fff))].find((i) => {
            const a = f.attack(i), tm = f.timing(i);
            return a && a.victim == null && !a.down && tm && tm.cancel > tm.hit + 1;
        });
        const tm = f.timing(id);
        p.pos = [-0.4, 0, 0]; o.pos = [0.4, 0, 0];
        let hit = null;
        for (let i = 1; i <= 60 && !hit; i++) {
            if (o.action !== 'move' || o.mot_coma >= tm.cancel - 1) {
                o.mot = null; o.pos = [0.4, 0, 0];
                setMotion(o, { rom: f.rom, motion: motionOf(f.rom, id) }, { state: ST.MOTION });
                Object.assign(o, { action: 'move', moveId: id, timing: tm, attack: null, pc_command: 0 });
                o.mot_coma = tm.hit;
                o.posed = o.body.pose(o.mot, o.mot_coma);
                const b = bodyPoint(o);
                o.pos[0] -= b[0] - 0.4; o.pos[2] -= b[2];
            }
            stepFight(fight, [{ P: i % 30 === 1 }, {}]);
            hit = fight.events.find((e) => e.kind === 'hit' && e.side === 0) ?? null;
        }
        assert.ok(hit, `${n}: a punch lands`);
        assert.ok(hit.counter, `${n}: a counter past the other's hit frame ${JSON.stringify(hit)} ${JSON.stringify(tm)}`);
        const a = p.attack ?? f.attack(p.moveId);
        assert.equal(hit.damage, counterDamage(g, a, f.attack(id).raw), `${n}: the counter's damage`);
        console.log('counter:', n, 'motion', id, JSON.stringify(tm), JSON.stringify(hit));
    }
}

/* In the air: attack_hit deals d * 3 >> 1 (StF on its own scale) on a
 * fighter whose mot_kind has mk_air and not mk_down; the jump motions'
 * motd_kind has no mk_air, the jump handler adds it at take-off (fix_hara).
 * VF2's air gives way to a struck-part test, so VF2 is left as it was. */
{
    const { airDamage, MK_AIR } = await import('../js/fighters.js');
    assert.equal(airDamage('fv', { damage: 18 }, MK_AIR), 27);
    assert.equal(airDamage('stf', { damage: 14, raw: 10 }, MK_AIR), 21, 'StF: 10 * 3 >> 1 = 15 of 140');
    assert.equal(airDamage('fv', { damage: 18 }, MK_AIR | (1 << 14)), null, 'not with mk_down');
    assert.equal(airDamage('vf2', { damage: 18 }, MK_AIR), null);
    assert.equal(airDamage('fv', { damage: 18 }, 1 << 12), null, 'mk_jump alone is not in the air');
    const { createFight, stepFight } = await import('../js/engine.js');
    for (const [n, g, reads] of [['AKIRA', 'vf2', false], ['PICKY', 'fv', true], ['SONIC', 'stf', true]]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        assert.ok(!(f.motKind(f.act('jump').motion.index) & MK_AIR), `${n}: the jump's motd_kind has no mk_air`);
        for (const jump of [true, false]) {
            const fight = createFight(f, f, f.game);
            fight.phase = 'fight';
            const [p, o] = fight.players;
            p.pos = [-0.45, 0, 0]; o.pos = [0.45, 0, 0];
            let hit = null, past = null;
            for (let i = 0; i < 90 && !hit; i++) {
                past = !!o.hara && o.hara === o.mot && o.mot_coma >= f.takeoff(o.mot.motion.index);
                stepFight(fight, [{ P: i === 0 }, { up: jump && i < 3 }]);
                hit = fight.events.find((e) => e.kind === 'hit' && e.side === 0) ?? null;
            }
            assert.ok(hit && !hit.counter, `${n}: the punch lands`);
            assert.equal(past, jump, `${n}: past the jump's take-off`);
            const base = p.attack.damage;
            assert.equal(hit.damage, jump ? airDamage(g, p.attack, MK_AIR) ?? base : base, `${n}: in the air ${jump}`);
            assert.equal(hit.air, jump && reads);
            console.log('air:', n, jump ? 'jumping' : 'standing', JSON.stringify(hit));
        }
    }
}

/* Going down: StF's attack_hit takes a quarter off a blow on a fighter
 * whose mot_kind has mk_down and not mk_down_pose, as its fall has until
 * play op 5 makes it lie (frame 64); FV and VF2 have no such step. */
{
    const { downDamage, MK_DOWN, MK_DOWN_POSE } = await import('../js/fighters.js');
    assert.equal(downDamage('stf', { damage: 14, raw: 10 }, MK_DOWN), 11, 'StF: 10 - 2 = 8 of 140');
    assert.equal(downDamage('stf', { damage: 14, raw: 10 }, MK_DOWN | MK_DOWN_POSE), null, 'not lying');
    assert.equal(downDamage('fv', { damage: 18 }, MK_DOWN), null);
    assert.equal(downDamage('vf2', { damage: 18 }, MK_DOWN), null);
    const { createFight, stepFight, setMotion, bodyPoint, ST } = await import('../js/engine.js');
    for (const [n, g] of [['AKIRA', 'vf2'], ['PICKY', 'fv'], ['SONIC', 'stf']]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        const ref = f.reaction({ game: g, kind: 0, side: 0, level: 1, damage: 30 }, 'down');
        if (g === 'stf') {
            const m = ref.motion;
            assert.equal(f.kindAt(m.index, 63, m.frames) & (MK_DOWN | MK_DOWN_POSE), MK_DOWN, 'the fall, before it lies');
            assert.equal(f.kindAt(m.index, 64, m.frames) & (MK_DOWN | MK_DOWN_POSE), MK_DOWN | MK_DOWN_POSE, 'lying from op 5');
        }
        /* a punch on the fall from its frame 4 (a lying StF body is too low
         * for the engine's capsule; kindAt above covers it) */
        {
            const from = 4;
            const fight = createFight(f, f, f.game);
            fight.phase = 'fight';
            const [p, o] = fight.players;
            p.pos = [-0.45, 0, 0]; o.pos = [0.45, 0, 0];
            setMotion(o, ref, { state: ST.YARARE });
            Object.assign(o, { action: 'down', knocked: true, mot_coma: from });
            o.posed = o.body.pose(o.mot, o.mot_coma);
            const b = bodyPoint(o);
            o.pos[0] -= b[0] - 0.3; o.pos[2] -= b[2];
            let hit = null, coma = null;
            for (let i = 0; i < 30 && !hit; i++) {
                coma = o.mot_coma;
                stepFight(fight, [{ P: i === 0 }, {}]);
                hit = fight.events.find((e) => e.kind === 'hit' && e.side === 0) ?? null;
            }
            assert.ok(hit && !hit.counter, `${n}: a blow lands on the fall from ${from}`);
            const going = g === 'stf' && coma < 64;
            assert.equal(hit.fall, going, `${n}: going down at ${coma}`);
            assert.equal(hit.damage, going ? downDamage(g, p.attack, MK_DOWN) : p.attack.damage);
            assert.ok(o.knocked, `${n}: a blow on the fall keeps it going down`);
            console.log('down:', n, 'fall frame', coma, JSON.stringify(hit));
        }
    }
}

/* The knock-down: attack_hit plays it, not the hit, on a strike whose word
 * (+0x828) has bit 14, on one of 50 or more (VF2 30; StF out of 140) unless
 * the word has bit 10, on a fighter going down, lying or in the air, and in
 * VF2 on bit 8 against one standing; the engine had any blow of 40 or more. */
{
    const { knocksDown, MK_AIR, MK_DOWN } = await import('../js/fighters.js');
    const move = (n, g, id) => fighters.find((x) => x.name === n && x.game === g).attack(id);
    const kd = (n, g, id, kind = 0, crouch = false) => { const a = move(n, g, id); return knocksDown(g, a, a.damage, kind, crouch); };
    assert.ok(kd('PICKY', 'fv', 89), 'FV: 26 with bit 14');
    assert.ok(!kd('PICKY', 'fv', 553), 'FV: 28 without');
    assert.ok(kd('SONIC', 'stf', 46), 'StF: 10 of 140 with bit 14');
    assert.ok(!kd('SONIC', 'stf', 179), 'StF: 30 of 140 (43 here) without');
    assert.ok(kd('AKIRA', 'vf2', 11), 'VF2: 30 without bit 14');
    assert.ok(!kd('AKIRA', 'vf2', 1), 'VF2: 14');
    assert.ok(move('AKIRA', 'vf2', 578).word & 1 << 8 && kd('AKIRA', 'vf2', 578, 0, true), 'VF2: 40 with bit 8, even crouching');
    assert.ok(knocksDown('vf2', { word: 1 << 8 }, 10, 0) && !knocksDown('vf2', { word: 1 << 8 }, 10, 0, true), 'VF2: bit 8, standing but not crouching');
    assert.ok(knocksDown('stf', { raw: 50, word: 0 }, 71, 0) && !knocksDown('stf', { word: 0 }, 70, 0), 'StF: 50 of 140');
    assert.ok(!knocksDown('fv', { word: 1 << 10 }, 60, 0), 'bit 10: no knock-down by damage');
    for (const g of ['vf2', 'fv', 'stf']) {
        assert.ok(knocksDown(g, { word: 0 }, 5, MK_AIR) && knocksDown(g, { word: 0 }, 5, MK_DOWN), `${g}: in the air, going down`);
    }
    assert.ok(knocksDown('vf2', { word: 0 }, 5, 1 << 26) && !knocksDown('fv', { word: 0 }, 5, 1 << 26), 'VF2 only: mk_sakadachi');
    assert.ok(knocksDown('fv', { ap: 1, word: 0 }, 5, 1 << 24) && !knocksDown('fv', { ap: 2, word: 0 }, 5, 1 << 24), 'ap 1 on mk_gacha');
    assert.ok(knocksDown('shenmue', {}, 40, 0) && !knocksDown('shenmue', {}, 39, 0), 'Shenmue: 40');
    /* a punch on one standing does not knock it down */
    const { createFight, stepFight } = await import('../js/engine.js');
    for (const [n, g] of [['AKIRA', 'vf2'], ['PICKY', 'fv'], ['SONIC', 'stf']]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        const fight = createFight(f, f, f.game);
        fight.phase = 'fight';
        const [p, o] = fight.players;
        p.pos = [-0.45, 0, 0]; o.pos = [0.45, 0, 0];
        let hit = null;
        for (let i = 0; i < 30 && !hit; i++) {
            stepFight(fight, [{ P: i === 0 }, {}]);
            hit = fight.events.find((e) => e.kind === 'hit' && e.side === 0) ?? null;
        }
        assert.ok(hit && !(p.attack.word & 1 << 14), `${n}: the punch lands, no bit 14`);
        assert.ok(!o.knocked && o.action === 'hit', `${n}: a hit, not a knock-down`);
        console.log('knock-down:', n, 'punch', JSON.stringify(hit));
    }
}

/* The hit combo: counted on each hit, and ended by action_after on the
 * first frame the fighter's mot_kind has no bit 0 (mk_change) out of its
 * stun: through a reaction, or a fall, the lying and the rise, back to its
 * stance; the engine had a one-second window. */
{
    const { createFight, stepFight, setMotion, ST } = await import('../js/engine.js');
    for (const [n, g] of [['AKIRA', 'vf2'], ['PICKY', 'fv'], ['SONIC', 'stf']]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        const kind = (o) => (o.fighter.kindAt ? o.fighter.kindAt(o.mot.motion.index, o.mot_coma, o.mot.motion.frames) : o.fighter.motKind(o.mot.motion.index));
        const free = (o) => o.state !== ST.YARARE && !(kind(o) & 1);
        /* a punch: 1, held through the reaction, 0 once free */
        {
            const fight = createFight(f, f, f.game);
            fight.phase = 'fight';
            const [p, o] = fight.players;
            p.pos = [-0.45, 0, 0]; o.pos = [0.45, 0, 0];
            let hit = null, i = 0;
            for (; i < 30 && !hit; i++) {
                stepFight(fight, [{ P: i === 0 }, {}]);
                hit = fight.events.find((e) => e.kind === 'hit' && e.side === 0) ?? null;
            }
            assert.ok(hit && o.hit_combo === 1, `${n}: one hit, combo 1`);
            let t = 0;
            for (; t < 200 && !free(o); t++) { assert.equal(o.hit_combo, 1, `${n}: held in the reaction`); stepFight(fight, [{}, {}]); }
            assert.ok(t < 200 && o.hit_combo === 0, `${n}: ended once free (${t} frames, ${o.action})`);
        }
        /* a knock-down: held through the fall, the lying and the rise, past
         * a second, then ended in the stance */
        {
            const fight = createFight(f, f, f.game);
            fight.phase = 'fight';
            const [, o] = fight.players;
            setMotion(o, f.reaction({ game: g, kind: 0, side: 0, level: 1, damage: 30 }, 'down'), { state: ST.YARARE });
            Object.assign(o, { action: 'down', knocked: true, hit_combo: 2 });
            let t = 0;
            for (; t < 600 && !(o.state !== ST.YARARE && o.state !== ST.DOWN && o.state !== ST.RISE && free(o)); t++) {
                assert.equal(o.hit_combo, 2, `${n}: held at frame ${t} (${o.state})`);
                stepFight(fight, [{}, {}]);
            }
            assert.ok(t > 60 && t < 600 && o.hit_combo === 0, `${n}: held ${t} frames, then ended`);
            console.log('combo:', n, 'knock-down held', t, 'frames');
        }
    }
}

/* A guard turned away: attack_hit guards only with en_flag's en_from_behind
 * clear, which get_en_info sets when the other is more than a quarter turn
 * off the fighter's facing; StF's and FV's not newly within 0.4 with one of
 * them in the air. The engine had the attacker's facing against the guard's
 * (a dot of 0.3). */
{
    const { fromBehind } = await import('../js/fighters.js');
    const deg = (a) => a * Math.PI / 180;
    for (const g of ['vf2', 'fv', 'stf']) {
        assert.equal(fromBehind(g, { off: 0, dist: 1 }), false, `${g}: ahead`);
        assert.equal(fromBehind(g, { off: deg(80), dist: 1 }), false, `${g}: 80 degrees off`);
        assert.equal(fromBehind(g, { off: deg(-100), dist: 1 }), true, `${g}: 100 degrees off`);
        assert.equal(fromBehind(g, { off: deg(180), dist: 0.3 }), true, `${g}: behind, close, on the ground`);
        assert.equal(fromBehind(g, { off: deg(180), dist: 0.3, was: true, air: true }), true, `${g}: stays on`);
        assert.equal(fromBehind(g, { off: deg(180), dist: 0.3, air: true }), g === 'vf2', `${g}: close in the air`);
        assert.equal(fromBehind(g, { off: deg(180), dist: 0.5, air: true }), true, `${g}: past 0.4 in the air`);
    }
    const { createFight, stepFight, setMotion, ST } = await import('../js/engine.js');
    for (const [n, g] of [['AKIRA', 'vf2'], ['PICKY', 'fv'], ['SONIC', 'stf']]) {
        const f = fighters.find((x) => x.name === n && x.game === g);
        /* held guard, the punch from in front: guarded */
        {
            const fight = createFight(f, f, f.game);
            fight.phase = 'fight';
            const [p, o] = fight.players;
            p.pos = [-0.45, 0, 0]; o.pos = [0.45, 0, 0];
            let ev = null;
            for (let i = 0; i < 40 && !ev; i++) {
                stepFight(fight, [{ P: i === 4 }, { G: true }]);
                assert.equal(o.en_behind, false, `${n}: the guard faces the other`);
                ev = fight.events.find((e) => (e.kind === 'hit' || e.kind === 'guard') && e.side === 0) ?? null;
            }
            assert.equal(ev?.kind, 'guard', `${n}: guarded from in front`);
        }
        /* a fighter in a motion (it does not turn) with the other at its back */
        {
            const fight = createFight(f, f, f.game);
            fight.phase = 'fight';
            const [p, o] = fight.players;
            p.pos = [-0.6, 0, 0]; o.pos = [0.6, 0, 0];
            setMotion(o, f.reaction({ game: g, kind: 0, side: 0, level: 1, damage: 30 }, 'down'), { state: ST.YARARE });
            o.yang = 0;
            stepFight(fight, [{}, {}]);
            assert.equal(o.en_behind, true, `${n}: the other at its back`);
            assert.equal(p.en_behind, false, `${n}: the other ahead`);
            console.log('behind:', n, 'guard from in front, the back seen');
        }
    }
}

/* The throw's reach: VF2's get_en_info (0x18768) sets en_flag bits 8 and 12
 * (front, to the record's +0x18 and +0x1C), 9 (crouching, +0x20), 10 and 13
 * (behind, +0x24), when the thrower faces the other to within 30° and the
 * other faces it or away; its throw entries want them. The engine had none
 * of them, so VF2 never threw, and threw within 1.5 bodies. */
{
    const { throwFlags } = await import('../js/fighters.js');
    const akira = fighters.find((x) => x.name === 'AKIRA' && x.game === 'vf2');
    assert.deepEqual(akira.throwRanges.map((r) => +r.toFixed(3)), [1.4, 1.7, 1.4, 1.4], 'Akira\'s ranges');
    assert.ok(!fighters.find((x) => x.game === 'stf').throwRanges, 'StF\'s are its own word');
    const deg = (a) => a * Math.PI / 180;
    const ranges = akira.throwRanges, KAMAE = 1 << 9, front = deg(180);
    const t = (o) => throwFlags({ off: 0, turn: front, dist: 1.3, kind: KAMAE, ranges, ...o });
    assert.equal(t({}), 1 << 8 | 1 << 12, 'near, in front');
    assert.equal(t({ dist: 1.6 }), 1 << 12, 'past +0x18, within +0x1C');
    assert.equal(t({ dist: 1.8 }), 0, 'out of reach');
    assert.equal(t({ crouch: true }), 1 << 9, 'crouching');
    assert.equal(t({ turn: deg(10) }), 1 << 10, 'its back turned');
    assert.equal(t({ turn: deg(10), crouch: true }), 1 << 13, 'its back turned, crouching');
    assert.equal(t({ turn: deg(90) }), 0, 'side on');
    assert.equal(t({ off: deg(31) }), 0, 'thrower 31 degrees off');
    assert.equal(t({ off: deg(29) }), 1 << 8 | 1 << 12, 'thrower 29 degrees off');
    assert.equal(t({ kind: KAMAE | 1 << 4 }), 0, 'the other in the air');
    assert.equal(t({ kind: 1 << 8 }), 0, 'the other striking (mk_attack only)');
    assert.equal(t({ kind: 1 << 13 }), 1 << 8 | 1 << 12, 'the other guarding');
    assert.equal(t({ ownKind: 1 << 4 }), 0, 'the thrower in the air');

    const { createFight, stepFight } = await import('../js/engine.js');
    const throwAt = (x) => {
        const fight = createFight(akira, akira, 'vf2');
        fight.phase = 'fight';
        const [p, o] = fight.players;
        p.pos = [-x / 2, 0, 0]; o.pos = [x / 2, 0, 0];
        for (let i = 0; i < 30; i++) {
            stepFight(fight, [{ P: i === 4, G: i === 4 }, {}]);
            const e = fight.events.find((v) => v.side === 0 && (v.kind === 'throw' || v.kind === 'move'));
            if (e) return e;
        }
        return null;
    };
    const near = throwAt(1.2), far = throwAt(1.9);
    assert.equal(near?.kind, 'throw', `Akira throws at 1.2 (${JSON.stringify(near)})`);
    assert.notEqual(far?.kind, 'throw', 'not at 1.9');
    console.log('throw reach: Akira', near.id, 'at 1.2;', far ? `${far.kind} ${far.name ?? far.id}` : 'nothing', 'at 1.9');
}
