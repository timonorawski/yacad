// Sample OBJ asset for the studio2 sample library — a small tetrahedron.
//
// Mirrors `SAMPLE_STL_BYTES` in seed-scenes.ts: a hand-rolled mesh encoded as
// a content-addressable blob and imported via the corresponding decoder node
// (`import-obj` here, vs `import-stl` for the cube). The shape is intentionally
// tiny and recognisable so the resulting scene reads as "an imported mesh"
// rather than a procedural primitive.
//
// Geometry: a tetrahedron with one apex on +Z and an equilateral base in the
// z = -5 plane, sized to roughly the same bounding extents as the cube sample
// (±10 mm). 4 vertices, 4 triangular faces — no fan triangulation needed, so
// the decoder's index buffer is a 1:1 transcription of the `f` lines.
//
//   v1 = ( 0,    0,    10)   ← apex
//   v2 = (10,    0,    -5)
//   v3 = (-5,   8.66,  -5)
//   v4 = (-5,  -8.66,  -5)
//
// Faces (1-based, OBJ convention; winding chosen so each triangle's normal
// points outward from the centroid):
//   f 1 3 2  — apex + (v3, v2)
//   f 1 4 3  — apex + (v4, v3)
//   f 1 2 4  — apex + (v2, v4)
//   f 2 3 4  — base
const SAMPLE_OBJ_TEXT = `# yacad sample: tetrahedron
v 0 0 10
v 10 0 -5
v -5 8.66 -5
v -5 -8.66 -5
f 1 3 2
f 1 4 3
f 1 2 4
f 2 3 4
`;

/** Encoded form ready to register as a content-addressable blob. */
export const SAMPLE_OBJ_BYTES: Uint8Array = new TextEncoder().encode(SAMPLE_OBJ_TEXT);

/** Vertex count of the decoded mesh — exposed for the unit test's assertion. */
export const SAMPLE_OBJ_VERTEX_COUNT = 4;

/** Triangle count of the decoded mesh — exposed for the unit test's assertion. */
export const SAMPLE_OBJ_TRIANGLE_COUNT = 4;
