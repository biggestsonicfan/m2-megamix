/*
 * Drawing a fight: a stage from any of the three games, two fighters from any
 * of them, each with what its own game would have in texture RAM and the
 * colour tables (noclip's ports of the games' unpack and table routines,
 * js/texture.js and js/colors.js) and shaded by noclip's fill shader.
 *
 * A Model 2 board holds one scene's sets at a time. Three games' sets do not
 * share a texture RAM, so each thing drawn here has a material of its own:
 * the stage its stage sets, a VF2/FV fighter its own pair over the game's
 * boot set, an StF fighter set 1 (every StF scene holds it) with the StF
 * scene's colour block.
 */
import * as THREE from 'three';
import { createModelMaterial, buildGeometry } from '../vendor/noclip/js/viewer.js';
import { buildTexram } from '../vendor/noclip/js/texture.js';
import { buildLumaram, buildColorxlat } from '../vendor/noclip/js/colors.js';
import { buildAtlas, microAtlas, ATLAS_W, ATLAS_H, MICRO_W, MICRO_H, LUMA_W, LUMA_H, CXLAT_W, CXLAT_H, palette555ToRGB } from '../vendor/noclip/js/atlas.js';
import { gameLighting } from '../vendor/noclip/js/stages.js';
import { decodeModel } from '../vendor/noclip/js/model.js';
import { readFrameTables, buildFlatDisplayList, buildStageDisplayList, opsAt } from '../vendor/noclip/js/display.js';
import { buildPlacementDisplayList } from '../vendor/noclip/js/placements.js';
import { ARENA } from './games.js';
import { bodyPoint } from './engine.js';

const dataTexture = (data, w, h) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RedFormat);
    t.needsUpdate = true;
    return t;
};

/* js/app.js atlasTexture: the sheets as the shader's atlas, with the
 * microtexture squares mipmapped beside it. */
function atlasTexture({ sheet0, sheet1 }) {
    const texels = buildAtlas(sheet0, sheet1);
    const atlas = dataTexture(texels, ATLAS_W, ATLAS_H);
    atlas.magFilter = THREE.LinearFilter;
    atlas.minFilter = THREE.LinearFilter;
    const micro = dataTexture(microAtlas(texels), MICRO_W, MICRO_H);
    micro.generateMipmaps = true;
    micro.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.userData.micro = micro;
    return atlas;
}

/* The scene's sets with the game's resident set ahead of them
 * (js/app.js texramQueue). */
const queue = (rom, sets) => (rom.game.texture.residentSet == null ? sets : [rom.game.texture.residentSet, ...sets]);

/* Composing a draw's ops (js/app.js composeOps). Billboards are left
 * standing as they are. */
const OP = new THREE.Matrix4();
function composeOps(out, ops) {
    out.identity();
    for (const [kind, v] of ops) {
        if (kind === 'b' || kind === 'cy' || kind === 'ce') continue;
        if (kind === 's') OP.makeScale(v[0], v[1], v[2]);
        else if (kind === 'r') OP.makeRotationY((v * Math.PI) / 180);
        else if (kind === 'rx') OP.makeRotationX((v * Math.PI) / 180);
        else if (kind === 'rz') OP.makeRotationZ((v * Math.PI) / 180);
        else if (kind === 'm') OP.set(v[0], v[3], v[6], 0, v[1], v[4], v[7], 0, v[2], v[5], v[8], 0, 0, 0, 0, 1);
        else OP.makeTranslation(v[0], v[1], v[2]);
        out.multiply(OP);
    }
    return out;
}

export class Renderer {
    constructor(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0);
        this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50000);
        this.viewport = new THREE.Vector4();
        this.scene.onBeforeRender = (r) => r.getCurrentViewport(this.viewport);
        this.stage = null;
        this.bodies = [];
        this.materials = new Map();
        this.side = null;
        this.cam = null;
        this.resize();
        addEventListener('resize', () => this.resize());
    }

    resize() {
        const c = this.renderer.domElement;
        const w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /* A material with tables of its own. `shade` is the light, the material
     * slots and the output scale (js/app.js applyStageShading). */
    material({ texram, luma, cxlat, shade }, props = {}) {
        const m = createModelMaterial();
        const u = m.uniforms;
        u.uAtlas.value = texram;
        u.uMicro.value = texram.userData.micro;
        u.uUseAtlas.value = 1;
        u.uLuma.value = luma;
        u.uCxlat.value = cxlat;
        u.uUseRamp.value = 1;
        u.uViewport.value = this.viewport;
        u.uZsortRecede.value = 0;
        u.uFogDensity.value = 0;
        u.uLight.value.set(...shade.light);
        shade.materials.forEach((x, i) => u.uMaterial.value[i]?.set(x.diffuse, x.ambient));
        u.uTint.value.set(1, 1, 1);
        u.uBright.value = shade.bright > 0 && shade.bright < 8 ? shade.bright : 1;
        return Object.assign(m, props);
    }

    luma(rom) {
        rom.megamixLuma ??= dataTexture(buildLumaram(rom), LUMA_W, LUMA_H);
        return rom.megamixLuma;
    }

    /* ---- the stage ---- */

    setStage(game, stage) {
        if (this.stage) {
            this.scene.remove(this.stage.group);
            this.stage.group.traverse((o) => o.geometry?.dispose());
            for (const m of this.stage.mats) { m.uniforms.uAtlas.value.userData.micro.dispose(); m.uniforms.uAtlas.value.dispose(); m.uniforms.uCxlat.value.dispose(); m.dispose(); }
        }
        const { rom } = game;
        const sets = stage.texSets?.length ? stage.texSets : [stage.texSet?.[0] ?? 0];
        const texram = atlasTexture(buildTexram(rom, queue(rom, sets)));
        const cxlatData = buildColorxlat(rom, { colorSet: stage.texSet[1], tint: stage.tint, fighters: [] });
        const cxlat = dataTexture(cxlatData, CXLAT_W, CXLAT_H);
        const tables = { texram, luma: this.luma(rom), cxlat, shade: stage };
        const mat = this.material(tables);
        const back = this.material({ ...tables, cxlat }, { depthTest: false, depthWrite: true });
        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.matrix.makeScale(ARENA[game.key].scale, ARENA[game.key].scale, ARENA[game.key].scale);
        const list = stage.placements
            ? buildPlacementDisplayList(stage, (i) => decodeModel(rom, i), 'game', stage.view)
            : rom.game.stageTable.flat ? buildFlatDisplayList(stage, { region: 0 })
                : buildStageDisplayList(stage, (rom.megamixFrames ??= readFrameTables(rom)));
        const cache = new Map();
        const m = new THREE.Matrix4();
        for (const entry of list) {
            if (entry.extra) continue;
            const key = entry.points ? `${entry.model}:${entry.points.key}` : entry.model;
            if (!cache.has(key)) {
                const d = entry.points ? decodeModel(rom, entry.model, entry.points.words) : decodeModel(rom, entry.model);
                cache.set(key, d?.positions.length ? buildGeometry(d) : null);
            }
            const geom = cache.get(key);
            if (!geom) continue;
            const mesh = new THREE.Mesh(geom, entry.backdrop ? back : mat);
            if (entry.backdrop) mesh.renderOrder = -10;
            else if (entry.layer === 'sky') mesh.renderOrder = -5;
            mesh.matrixAutoUpdate = false;
            mesh.matrix.copy(composeOps(m, opsAt(entry, 0)));
            mesh.frustumCulled = false;
            group.add(mesh);
        }
        this.scene.add(group);
        const bg555 = rom.game.stageTable.backdrop ?? stage.bgColor555;
        const rgb = bg555 != null ? palette555ToRGB(cxlatData, bg555) : [0, 0, 0];
        this.scene.background = new THREE.Color(...rgb);
        this.stage = { group, mats: [mat, back], game, stage };
    }

    /* ---- the fighters ---- */

    /* What a fighter is drawn with, built once per fighter and scene. `scene`
     * is a stage of the fighter's own game: an StF fighter wears its sets and
     * colour block, and a game without a lighting block of its own (FV) takes
     * its light. */
    fighterMaterial(f, scene) {
        const key = `${f.game}:${f.name}:${scene.slot}`;
        if (this.materials.has(key)) return this.materials.get(key);
        const { rom } = f;
        let tables;
        if (f.look.kind === 'stf') {
            const texram = atlasTexture(buildTexram(rom, queue(rom, scene.texSets)));
            const cxlat = dataTexture(buildColorxlat(rom, { colorSet: scene.texSet[1], tint: scene.tint, fighters: [f.look.fighter] }), CXLAT_W, CXLAT_H);
            tables = { texram, luma: this.luma(rom), cxlat, shade: scene };
        } else {
            const texram = atlasTexture(buildTexram(rom, f.look.sets));
            const cxlat = dataTexture(buildColorxlat(rom, { colorSet: f.look.set, tint: [1, 1, 1], fighters: [f.look.fighter] }), CXLAT_W, CXLAT_H);
            const lit = gameLighting(rom) ?? scene;
            tables = { texram, luma: this.luma(rom), cxlat, shade: { light: lit.light, materials: lit.materials, bright: 1 } };
        }
        const mat = this.material(tables);
        this.materials.set(key, mat);
        return mat;
    }

    /* Two fighters, in the scene from now on. `sceneOf(gameKey)` is the stage
     * of that game a fighter from it is lit by (see fighterMaterial). */
    setFighters(players, sceneOf) {
        for (const b of this.bodies) {
            this.scene.remove(b.group);
            for (const mesh of b.pool) if (mesh.userData.dynamic) mesh.geometry.dispose();
        }
        this.bodies = players.map((p) => {
            const group = new THREE.Group();
            this.scene.add(group);
            return { p, group, pool: [], geoms: new Map(), mat: this.fighterMaterial(p.fighter, sceneOf(p.fighter.game)) };
        });
    }

    placeFighters() {
        const W = new THREE.Matrix4(), M = new THREE.Matrix4();
        for (const b of this.bodies) {
            const { p } = b;
            W.makeRotationY(p.yang).setPosition(p.pos[0], p.pos[1], p.pos[2]);
            const parts = p.posed?.parts ?? [];
            parts.forEach((part, i) => {
                let mesh = b.pool[i];
                if (!mesh) {
                    mesh = new THREE.Mesh(new THREE.BufferGeometry(), b.mat);
                    mesh.matrixAutoUpdate = false;
                    mesh.frustumCulled = false;
                    b.pool.push(mesh);
                    b.group.add(mesh);
                }
                if (part.dynamic) {
                    if (mesh.userData.dynamic) mesh.geometry.dispose();
                    mesh.geometry = buildGeometry(part.dynamic);
                    mesh.userData = { dynamic: true, key: null };
                } else if (mesh.userData.key !== part.key) {
                    if (mesh.userData.dynamic) mesh.geometry.dispose();
                    if (!b.geoms.has(part.key)) {
                        const d = p.body.decode(part.key);
                        b.geoms.set(part.key, d?.positions.length ? buildGeometry(d) : new THREE.BufferGeometry());
                    }
                    mesh.geometry = b.geoms.get(part.key);
                    mesh.userData = { dynamic: false, key: part.key };
                }
                mesh.visible = true;
                mesh.matrix.copy(W).multiply(M.fromArray(part.matrix));
            });
            for (let i = parts.length; i < b.pool.length; i++) b.pool[i].visible = false;
        }
    }

    /* ---- the camera ---- */

    /* Side on to the line between the two, the first player on the left, and
     * kept on its side when they cross, as the fight cameras do. Returns the
     * screen's right in the world, (x, z), which the pads are read by. */
    follow(players, { snap = false } = {}) {
        const [a, b] = players.map(bodyPoint);
        const d = [b[0] - a[0], b[2] - a[2]];
        const len = Math.hypot(d[0], d[1]) || 1;
        let n = [-d[1] / len, d[0] / len];
        if (this.side && n[0] * this.side[0] + n[1] * this.side[1] < 0) n = [-n[0], -n[1]];
        if (!this.side || snap) this.side = n;
        else {
            const k = 0.08;
            this.side = [this.side[0] + (n[0] - this.side[0]) * k, this.side[1] + (n[1] - this.side[1]) * k];
            const l = Math.hypot(...this.side) || 1;
            this.side = [this.side[0] / l, this.side[1] / l];
        }
        const mid = [(a[0] + b[0]) / 2, 1.0, (a[2] + b[2]) / 2];
        const dist = Math.max(5, len * 1.15 + 2.6);
        const want = { at: mid, from: [mid[0] + this.side[0] * dist, 1.55, mid[2] + this.side[1] * dist] };
        if (!this.cam || snap) this.cam = want;
        else {
            const k = 0.12;
            for (const key of ['at', 'from']) this.cam[key] = this.cam[key].map((v, i) => v + (want[key][i] - v) * k);
        }
        this.camera.position.set(...this.cam.from);
        this.camera.lookAt(...this.cam.at);
        return [this.side[1], -this.side[0]];
    }

    draw() {
        this.renderer.render(this.scene, this.camera);
    }
}
