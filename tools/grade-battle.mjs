/*
 * Grade a battle on the board build against the same battle in its source
 * game: two logs of tools/mame/battle.lua, the same fighters, stage and
 * input script (docs/GRADING.md). The browser build's log
 * (tools/js-battle.mjs) stands in for the board's the same way.
 *
 *   node tools/grade-battle.mjs <source log> <board log> [--json]
 *
 * It grades, round by round:
 *   - the setup: fighters, stage, energy, clock, rounds to win;
 *   - sync: the first frame the two fights part (a fighter's motion, or his
 *     place by more than 0.05), and how much of the round they stay
 *     together. Places are compared in the round's own frame: from the
 *     midpoint between the fighters at the round's start, the x axis
 *     through 2P (a game may start them turned on the stage; the setup
 *     notes it). The board's frames may be a few off the source's (its
 *     round's first frame is found by the clock); the offset of -4..4
 *     that keeps them together longest is used, and given;
 *   - the motions: each fighter's run of motions (a new entry each time
 *     mot_num changes), how much of the source's the board's matches (LCS);
 *   - the hits: every energy drop, by frame, fighter and amount, matched in
 *     order; a hit the source has that the board lacks, or deals otherwise;
 *   - the round's end: who won, on which frame, the energy left.
 * and gives each a score out of 100 and the battle a letter.
 */
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const [srcPath, brdPath] = args.filter((a) => !a.startsWith('--'));
if (!srcPath || !brdPath) {
    console.error('usage: node tools/grade-battle.mjs <source log> <board log> [--json]');
    process.exit(2);
}

/* A game's unit on the board: its fighters' size there over their own
 * (tools/vf2-guest.mjs SCALE, tools/fv-stages.mjs FV_SCALE). */
const UNITS = { vf2: (71 / 73) * (1.670 / 1.309) * (2.676 / 1.638), fv: 2.676 / 1.309 };

/* The board draws VF2's and FV's fighters and stages at StF's size
 * (UNITS), so its places are taken back to the source's units. */
function toSourceUnits(src, brd, report) {
    const u = brd.setup?.game === 'board' ? UNITS[src.setup?.game] ?? 1 : 1;
    if (u === 1) return;
    /* (a step the log skipped shares the step before's fighters) */
    const seen = new Set();
    for (const r of brd.rounds) for (const fr of r.frames) for (const q of fr.p) {
        if (seen.has(q)) continue;
        seen.add(q); q.x /= u; q.y /= u; q.z /= u;
    }
    report.notes.push(`places: the board's divided by ${u.toFixed(3)}, ${src.setup.game}'s size on the board`);
}

export function readLog(text) {
    const log = { setup: null, rounds: [], error: null, done: false };
    for (const line of text.split('\n')) {
        if (line.startsWith('setup ')) {
            const [, game, ...kv] = line.split(' ');
            log.setup = { game, ...Object.fromEntries(kv.map((s) => s.split('=')).map(([k, v]) => [k, Number(v)])) };
        } else if (line.startsWith('end ')) {
            const m = line.match(/^end r(\d+) k=(\d+) wins=(\d+),(\d+) energy=(-?\d+),(-?\d+) sub=(\d+)/);
            const r = log.rounds[Number(m[1]) - 1];
            r.end = { k: +m[2], wins: [+m[3], +m[4]], energy: [+m[5], +m[6]], sub: +m[7] };
        } else if (/^r\d+ /.test(line)) {
            const [head, a, b] = line.split(' | ');
            const [r, k, timer] = head.split(' ');
            const n = Number(r.slice(1));
            const round = (log.rounds[n - 1] ??= { frames: [], end: null });
            const f = (s) => {
                const [x, y, z, mot, coma, energy, st, yang, , chr] = s.split(' ').map(Number);
                return { x, y, z, mot, coma, energy, st, yang, chr };
            };
            round.frames.push({ k: +k, timer: +timer, p: [f(a), f(b)] });
        } else if (line.startsWith('error ')) log.error = line.slice(6);
        else if (line === 'done') log.done = true;
    }
    /* one entry a step: a step the log skips (a game that stepped twice in
     * a frame) holds the frame before it; the steps before the first held
     * by the first */
    for (const r of log.rounds) {
        const out = [];
        for (const f of r.frames) {
            while (out.length < f.k) out.push({ ...(out.length ? out[out.length - 1] : f), k: out.length });
            if (out.length === f.k) out.push(f);
        }
        r.frames = out;
    }
    return log;
}

/* The round in its own frame: the midpoint of the fighters' start at the
 * origin, 1P toward -x and 2P toward +x. */
function normalize(frames) {
    const f0 = frames[0];
    if (!f0) return { frames, turn: 0, start: null };
    const [a, b] = f0.p;
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    const ang = Math.atan2(b.z - a.z, b.x - a.x);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    const turn = Math.round((ang / (2 * Math.PI)) * 65536);
    const out = frames.map((f) => ({ ...f, p: f.p.map((q) => {
        const x = q.x - cx, z = q.z - cz;
        return { ...q, x: x * c - z * s, z: x * s + z * c, yang: (q.yang + turn) & 0xffff };
    }) }));
    return { frames: out, turn, start: [[a.x, a.z, a.yang], [b.x, b.z, b.yang]] };
}

/* Each fighter's run of motions: [mot, first frame] each time it changes. */
function motionRuns(frames, p) {
    const runs = [];
    for (const f of frames) {
        const m = f.p[p].mot;
        if (!runs.length || runs[runs.length - 1].mot !== m) runs.push({ mot: m, k: f.k });
    }
    return runs;
}

function lcs(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    return dp[a.length][b.length];
}

/* The hits: every frame a fighter's energy drops. A round's last blow
 * can land on the frame it is judged, which the board logs no frame of:
 * the end line's energy has it. A knock-out takes what is left of the
 * bar, whatever the blow's damage (ko). */
function hits(frames, end) {
    const out = [];
    for (let i = 1; i < frames.length; i++)
        for (const p of [0, 1]) {
            const d = frames[i - 1].p[p].energy - frames[i].p[p].energy;
            if (d > 0) out.push({ k: frames[i].k, p, dmg: d, by: frames[i].p[1 - p].mot, ko: frames[i].p[p].energy <= 0 });
        }
    const last = frames[frames.length - 1];
    if (end && last)
        for (const p of [0, 1]) {
            const d = last.p[p].energy - Math.max(0, end.energy[p]);
            if (d > 0) out.push({ k: end.k, p, dmg: d, by: last.p[1 - p].mot, ko: end.energy[p] <= 0 });
        }
    return out;
}

/* Match the board's hits to the source's in order: same fighter hit, within
 * 30 frames. */
function matchHits(src, brd) {
    const used = new Set(), pairs = [], missing = [];
    for (const h of src) {
        const j = brd.findIndex((b, i) => !used.has(i) && b.p === h.p && Math.abs(b.k - h.k) <= 30);
        if (j < 0) { missing.push(h); continue; }
        used.add(j);
        pairs.push([h, brd[j]]);
    }
    const extra = brd.filter((_, i) => !used.has(i));
    return { pairs, missing, extra };
}

function firstSplit(a, b, from = 0) {
    const n = Math.min(a.length, b.length);
    for (let i = from; i < n; i++)
        for (const p of [0, 1]) {
            const s = a[i].p[p], t = b[i].p[p];
            if (s.mot !== t.mot) return { k: a[i].k, p, why: `motion ${s.mot} vs ${t.mot}` };
            const d = Math.hypot(s.x - t.x, s.z - t.z);
            if (d > 0.05) return { k: a[i].k, p, why: `place off by ${d.toFixed(3)} (${s.x.toFixed(2)},${s.z.toFixed(2)} vs ${t.x.toFixed(2)},${t.z.toFixed(2)})` };
        }
    return null;
}

/* frames a press takes to show in a fighter's motion */
const REACT = 4;

const winner = (e) => (e.wins[0] > e.wins[1] ? 0 : e.wins[1] > e.wins[0] ? 1 : -1);

export function grade(src, brd) {
    const report = { setup: [], notes: [], rounds: [], scores: {} };
    if (src.error) report.setup.push(`source log: ${src.error}`);
    if (brd.error) report.setup.push(`board log: ${brd.error}`);
    /* Another game's fighters come in on StF's bar (their damage scaled to
     * its energy, tools/vf2-guest.mjs), so against VF2 or FV the board runs
     * StF's energy and damage and energy are compared as shares of each
     * game's bar: the source's scaled by f, the same within a point, or
     * both knock-outs (each takes the rest of its bar). The
     * browser build (tools/js-battle.mjs) runs one bar for every game. */
    const cross = src.setup && (src.setup.game !== 'stf' || brd.setup?.game === 'js');
    const f = cross && src.setup.energy && brd.setup?.energy ? brd.setup.energy / src.setup.energy : 1;
    const sameDmg = (a, b) => (f === 1 ? a.dmg === b.dmg : (a.ko && b.ko) || Math.abs(a.dmg * f - b.dmg) <= 1);
    if (f !== 1) report.notes.push(`energy: source ${src.setup.energy}, board ${brd.setup.energy}: the source's damage scaled by ${f.toFixed(3)}`);
    toSourceUnits(src, brd, report);
    for (const key of cross ? ['wins_needed', 'time'] : ['energy', 'wins_needed', 'time'])
        if (src.setup && brd.setup && src.setup[key] !== brd.setup[key])
            report.setup.push(`${key}: source ${src.setup[key]}, board ${brd.setup[key]}`);
    const sum = { sync: 0, motions: 0, hits: 0, end: 0 };
    const n = Math.min(src.rounds.length, brd.rounds.length);
    let prevWins = [[0, 0], [0, 0]];
    for (let r = 0; r < n; r++) {
        const lead = src.setup?.lead ?? 0;
        const NS = normalize(src.rounds[r].frames), NB = normalize(brd.rounds[r].frames);
        if (NS.start && NB.start) {
            const fmt = (st) => st.map(([x, z, y]) => `(${x.toFixed(2)}, ${z.toFixed(2)}) facing ${y}`).join(' and ');
            const same = NS.start.every((q, i) => q.every((v, j) => Math.abs(v - NB.start[i][j]) < (j === 2 ? 2 : 0.01)));
            if (!same) report.notes.push(`round ${r + 1}: start: source ${fmt(NS.start)}, board ${fmt(NB.start)}`);
        }
        /* the characters the round runs (2P is character + 26 against himself) */
        const c0 = src.rounds[r].frames[0]?.p.map((q) => q.chr), c1 = brd.rounds[r].frames[0]?.p.map((q) => q.chr);
        if (c0?.[0] !== undefined && c1?.[0] !== undefined && !Number.isNaN(c1[0]) && (c0[0] !== c1[0] || c0[1] !== c1[1]))
            report.notes.push(`round ${r + 1}: characters: source ${c0}, board ${c1}`);
        /* the pose each holds when the script starts (a game's round intro:
         * StF's round 1 has some fighters in an entrance pose until they move) */
        const pose = (N) => N.frames[Math.min(lead, N.frames.length - 1)]?.p.map((q) => q.mot);
        const ps = pose(NS), pb = pose(NB);
        if (ps && pb && (ps[0] !== pb[0] || ps[1] !== pb[1]))
            report.notes.push(`round ${r + 1}: poses on frame ${lead}: source ${ps}, board ${pb}`);
        /* the offset that keeps the two together longest, from the script's
         * first presses on (a few frames after the lead, so a fighter's
         * intro pose, which his first press ends, is not a split) */
        const from = lead + REACT;
        let shift = 0, best = -1;
        for (let d = -4; d <= 4; d++) {
            const a = NS.frames.slice(Math.max(0, d)), b = NB.frames.slice(Math.max(0, -d));
            const sp = firstSplit(a, b, from);
            const len = sp ? sp.k - a[0].k : Math.min(a.length, b.length);
            if (len > best) { best = len; shift = d; }
        }
        const S = { frames: NS.frames.slice(Math.max(0, shift)), end: src.rounds[r].end };
        const B = { frames: NB.frames.slice(Math.max(0, -shift)), end: brd.rounds[r].end };
        const len = Math.min(S.frames.length, B.frames.length);
        const split = firstSplit(S.frames, B.frames, from);
        const sync = split ? Math.min(1, Math.max(0, split.k - S.frames[0].k - from) / Math.max(1, len - from)) : 1;
        const mot = [0, 1].map((p) => {
            const a = motionRuns(S.frames, p).map((x) => x.mot), b = motionRuns(B.frames, p).map((x) => x.mot);
            return { src: a.length, brd: b.length, common: lcs(a, b), score: lcs(a, b) / Math.max(1, a.length, b.length) };
        });
        const hs = hits(S.frames, S.end), hb = hits(B.frames, B.end);
        const m = matchHits(hs, hb);
        const same = m.pairs.filter(([a, b]) => sameDmg(a, b)).length;
        const hitScore = hs.length + hb.length === 0 ? 1 : (m.pairs.length + same) / (2 * Math.max(hs.length, hb.length));
        const roundWin = (E, prev) => (E ? winner({ wins: [E.wins[0] - prev[0], E.wins[1] - prev[1]] }) : null);
        const ws = roundWin(S.end, prevWins[0]), wb = roundWin(B.end, prevWins[1]);
        let endScore = 0;
        const endNotes = [];
        if (S.end && B.end) {
            if (ws === wb) endScore += 0.5; else endNotes.push(`winner: source ${ws < 0 ? 'none' : `${ws + 1}P`}, board ${wb < 0 ? 'none' : `${wb + 1}P`}`);
            const dk = Math.abs(S.end.k - B.end.k);
            endScore += 0.25 * Math.max(0, 1 - dk / 300);
            if (dk) endNotes.push(`ends on frame ${S.end.k} (source), ${B.end.k} (board)`);
            const de = Math.abs(S.end.energy[0] * f - B.end.energy[0]) + Math.abs(S.end.energy[1] * f - B.end.energy[1]);
            endScore += 0.25 * Math.max(0, 1 - de / 100);
            if (de) endNotes.push(`energy left ${S.end.energy} (source), ${B.end.energy} (board)`);
            prevWins = [S.end.wins, B.end.wins];
        } else endNotes.push('a round has no end in one log');
        const round = {
            round: r + 1, frames: [src.rounds[r].frames.length, brd.rounds[r].frames.length], shift, split, sync,
            motions: mot, hits: { source: hs.length, board: hb.length, matched: m.pairs.length, sameDamage: same,
                missing: m.missing, extra: m.extra, differ: m.pairs.filter(([a, b]) => !sameDmg(a, b)) },
            hitScore, end: { source: S.end, board: B.end, notes: endNotes }, endScore,
        };
        report.rounds.push(round);
        sum.sync += sync; sum.motions += (mot[0].score + mot[1].score) / 2; sum.hits += hitScore; sum.end += endScore;
    }
    if (src.rounds.length !== brd.rounds.length)
        report.setup.push(`rounds: source ${src.rounds.length}, board ${brd.rounds.length}`);
    for (const k in sum) report.scores[k] = Math.round((100 * sum[k]) / Math.max(1, n));
    const total = 0.2 * report.scores.sync + 0.3 * report.scores.motions + 0.3 * report.scores.hits + 0.2 * report.scores.end
        - 10 * report.setup.length;
    report.scores.total = Math.max(0, Math.round(total));
    report.letter = total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : total >= 40 ? 'D' : 'F';
    return report;
}

function print(src, brd, rep) {
    const s = src.setup ?? {}, b = brd.setup ?? {};
    console.log(`source ${s.game} c0=${s.c0} c1=${s.c1} stage=${s.stage}; board c0=${b.c0} c1=${b.c1} stage=${b.stage}; seed ${s.seed}`);
    for (const l of rep.setup) console.log(`  setup: ${l}`);
    for (const l of rep.notes) console.log(`  note: ${l}`);
    for (const r of rep.rounds) {
        console.log(`round ${r.round}: ${r.frames[0]} / ${r.frames[1]} frames, the board's ${r.shift ? `${Math.abs(r.shift)} ${r.shift < 0 ? 'behind' : 'ahead'}` : 'in step'}`);
        console.log(`  sync ${(100 * r.sync).toFixed(0)}%${r.split ? `: parts on frame ${r.split.k}, ${r.split.p + 1}P's ${r.split.why}` : ', never parts'}`);
        r.motions.forEach((m, p) => console.log(`  ${p + 1}P motions: ${m.common} of ${m.src} (source) / ${m.brd} (board) in order, ${(100 * m.score).toFixed(0)}%`));
        const h = r.hits;
        console.log(`  hits: source ${h.source}, board ${h.board}, matched ${h.matched}, same damage ${h.sameDamage}`);
        for (const x of h.missing.slice(0, 8)) console.log(`    missing on the board: frame ${x.k}, ${x.p + 1}P takes ${x.dmg} (by motion ${x.by})`);
        for (const x of h.extra.slice(0, 8)) console.log(`    only on the board:   frame ${x.k}, ${x.p + 1}P takes ${x.dmg} (by motion ${x.by})`);
        for (const [a, c] of h.differ.slice(0, 8)) console.log(`    damage differs: frame ${a.k}/${c.k}, ${a.p + 1}P takes ${a.dmg} / ${c.dmg} (motion ${a.by} / ${c.by})`);
        console.log(`  end: ${r.end.notes.length ? r.end.notes.join('; ') : 'the same'}`);
    }
    const sc = rep.scores;
    console.log(`scores: sync ${sc.sync}, motions ${sc.motions}, hits ${sc.hits}, end ${sc.end}; total ${sc.total} (${rep.letter})`);
}

const src = readLog(readFileSync(srcPath, 'utf8')), brd = readLog(readFileSync(brdPath, 'utf8'));
/* A guest plays his own game's motions under new ids (from 519 on); the
 * import's guests.json maps them back (motionIds, the board's id -> his
 * game's), so his motions compare with the source's. */
const GUESTS = new URL('../board/roms/guests.json', import.meta.url).pathname;
if (src.setup && src.setup.game !== 'stf' && brd.setup?.game === 'board' && existsSync(GUESTS)) {
    const game = { vf2: 'VF2', fv: 'Fighting Vipers' }[src.setup.game];
    for (const g of JSON.parse(readFileSync(GUESTS, 'utf8')).guests) {
        if (g.game !== game || !g.motionIds) continue;
        for (const r of brd.rounds) for (const f of r.frames) for (const q of f.p)
            if (g.chars.includes(q.chr) && g.motionIds[q.mot] !== undefined) q.mot = g.motionIds[q.mot];
    }
}
const rep = grade(src, brd);
if (JSON_OUT) console.log(JSON.stringify(rep, null, 1));
else print(src, brd, rep);
