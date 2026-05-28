import { describe, expect, it } from 'vitest';
import { decodeObj } from '@yacad/import-obj';
import { SAMPLE_OBJ_BYTES, SAMPLE_OBJ_VERTEX_COUNT, SAMPLE_OBJ_TRIANGLE_COUNT } from './sample-obj';

describe('SAMPLE_OBJ_BYTES', () => {
  it('decodes to the expected tetrahedron mesh', () => {
    const mesh = decodeObj(SAMPLE_OBJ_BYTES);
    // 4 vertices × 3 floats = 12 entries in the position buffer.
    expect(mesh.vertices.length).toBe(SAMPLE_OBJ_VERTEX_COUNT * 3);
    // 4 triangles × 3 indices = 12 entries in the index buffer.
    expect(mesh.indices.length).toBe(SAMPLE_OBJ_TRIANGLE_COUNT * 3);
    // Sanity-check the apex vertex round-trips verbatim.
    expect(Array.from(mesh.vertices.slice(0, 3))).toEqual([0, 0, 10]);
  });
});
