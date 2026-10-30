/*
 * The fight: one engine for fighters from all three games.
 *
 * The player record is the AM2 one, the rob: its fields keep the names AM2's
 * debug mode prints beside them (docs/DEBUG-MODE.md, ROBn_INFO), and the
 * comment beside each is its offset in Sonic the Fighters' rob (VF2's and
 * FV's hold the same fields). What drives it is the games' own
 * data: motions, action tables, the input matcher's tables, the setup
 * records' timing, strike and throw ops, and the reaction tables. Where the
 * three games' rules differ or are not read here, the engine says what it
 * does instead (the comments marked "here").
 *
 * No three.js: the Node test runs a bout through it.
 */
export { ST, ST_NAME, FPS, toWorld } from './engine/state.js';
export { makePlayer, setMotion, bodyPoint } from './engine/player.js';
export { createFight, stepFight } from './engine/rounds.js';
export { wallSide } from './engine/arena.js';
export { cpuPad } from './engine/cpu.js';
