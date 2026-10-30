/*
 * A CPU player: a plain opponent whose output is a pad.
 * Part of js/engine.js.
 */
import { ST, flat } from './state.js';
import { bodyPoint } from './player.js';

/* ---- a CPU player -------------------------------------------------------- */

/* Here: a plain opponent for testing and for one player. It walks in, then
 * pokes, guards what it sees coming, throws now and then. Its output is a
 * pad like a person's, so it goes through the matcher like one. */
export function cpuPad(fight, me, rng = Math.random, screenRight = [1, 0]) {
    const o = fight.players[1 - me.side];
    const d = flat(bodyPoint(me), bodyPoint(o));
    const pad = {};
    const [ox, , oz] = bodyPoint(o), [mx, , mz] = bodyPoint(me);
    const toRight = (ox - mx) * screenRight[0] + (oz - mz) * screenRight[1] > 0;
    const fwd = toRight ? 'right' : 'left', back = toRight ? 'left' : 'right';
    me.cpu ??= { plan: null, until: 0 };
    const c = me.cpu;
    if (fight.tick >= c.until) {
        const r = rng();
        if (o.state === ST.MOTION && d < 2.2 && r < 0.45) c.plan = 'guard';
        else if (d > 1.8) c.plan = r < 0.15 ? 'dash' : 'walk';
        else if (r < 0.1) c.plan = 'throw';
        else if (r < 0.2) c.plan = 'back';
        else if (r < 0.3) c.plan = 'low';
        else c.plan = r < 0.65 ? 'punch' : 'kick';
        c.until = fight.tick + 8 + Math.floor(rng() * 14);
        c.started = fight.tick;
    }
    const t = fight.tick - c.started;
    switch (c.plan) {
    case 'walk': pad[fwd] = true; break;
    case 'dash': pad[fwd] = t === 0 || t === 2; break;
    case 'back': pad[back] = true; break;
    case 'guard': pad.G = true; break;
    case 'throw': pad.G = pad.P = t < 2; break;
    case 'low': pad.down = true; pad.K = t === 2; break;
    case 'punch': pad.P = t === 0 || t === 6; break;
    case 'kick': pad.K = t === 0; break;
    }
    return pad;
}
