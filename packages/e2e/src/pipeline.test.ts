import { describe, expect, it } from 'vitest';
import { triangleCount } from '@yacad/geometry';
import { loadScenes, runScene, summarize } from './pipeline';

const scenes = loadScenes();

describe('scene → STL pipeline', () => {
  it('discovers the seeded scene library', () => {
    expect(scenes.length).toBeGreaterThanOrEqual(8);
  });

  for (const { name, doc } of scenes) {
    describe(name, () => {
      it('produces a non-empty mesh and a well-formed binary STL', async () => {
        const run = await runScene(doc);

        if (run.geometry.kind === '2d') {
          // 2D scenes: check for non-empty polygon output; no STL produced.
          const totalVerts = run.geometry.section.polygons.reduce((n, p) => n + p.length, 0);
          expect(totalVerts).toBeGreaterThan(0);
          expect(run.stl).toBeNull();
        } else {
          // 3D scenes: check mesh + binary STL.
          const tris = triangleCount(run.geometry.mesh);
          expect(tris).toBeGreaterThan(0);

          // Binary STL: triangle count at offset 80, fixed 84 + 50*tris bytes.
          expect(run.stl).not.toBeNull();
          const view = new DataView(run.stl!.buffer);
          expect(view.getUint32(80, true)).toBe(tris);
          expect(run.stl!.byteLength).toBe(84 + 50 * tris);
        }

        // Cold cache: real work happens. (Content-addressed dedup may still
        // produce hits for identical sibling subtrees — e.g. two identical
        // cubes — which is correct, so we assert misses rather than hits === 0.)
        expect(run.result.stats.misses).toBeGreaterThan(0);
      });

      it('matches the captured geometry summary', async () => {
        expect(summarize(await runScene(doc))).toMatchSnapshot();
      });

      it('is byte-for-byte deterministic across runs', async () => {
        const [a, b] = await Promise.all([runScene(doc), runScene(doc)]);
        expect(a.stl).toEqual(b.stl);
      });
    });
  }
});
