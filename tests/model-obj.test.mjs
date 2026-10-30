/* A fighter from each game out to OBJ and MTL and back (tools/board/model-obj.mjs):
 * every face as the ROM's, and every mesh in no more records. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadNodeGames } from './node-roms.mjs';
import { whoIs, exportFighter, readObjDir, fighterPieces, compareWithRom } from '../tools/board/model-obj.mjs';

const games = await loadNodeGames();
const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'model-obj-'));
try {
    for (const who of ['AKIRA', 'MAHLER', 'SONIC']) {
        const f = await whoIs(games, who);
        const dir = join(root, who);
        const r = await exportFighter(games, f, dir);
        const back = readObjDir(dir);
        const c = compareWithRom(back.pieces, fighterPieces(f));
        console.log(`${who.padEnd(6)} ${r.objects} objects, ${r.faces} faces, ${r.materials} materials, ${r.textures} textures;`,
            `${c.same}/${c.faces} faces as the ROM's, ${c.chained}/${c.meshes} meshes chained`);
        assert.deepEqual(c.bad, [], `${who}: ${c.bad[0]}`);
        assert.equal(c.same, c.faces, `${who}: faces`);
        assert.equal(c.chained, c.meshes, `${who}: meshes`);
        assert.ok(c.worst < 1e-9, `${who}: point error ${c.worst}`);
    }
} finally {
    rmSync(root, { recursive: true, force: true });
}
console.log('ok');
