import { describe, expect, it } from 'vitest';
import { decodeObj, ObjDecodeError } from './decode-obj';

const ENC = new TextEncoder();
const obj = (s: string): Uint8Array => ENC.encode(s);

describe('decodeObj', () => {
  it('decodes a single triangle', () => {
    const mesh = decodeObj(
      obj(`
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
    `),
    );
    expect(mesh.vertices).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('fan-triangulates a quad face', () => {
    const mesh = decodeObj(
      obj(`
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
    `),
    );
    // Fan from v0: (0,1,2) + (0,2,3)
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
  });

  it('strips face vertex texcoord/normal references (v/vt/vn syntax)', () => {
    const mesh = decodeObj(
      obj(`
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 1
vt 0 0
f 1/1/1 2/1/1 3/1/1
    `),
    );
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('resolves negative (relative) face indices per OBJ spec', () => {
    const mesh = decodeObj(
      obj(`
v 0 0 0
v 1 0 0
v 0 1 0
f -3 -2 -1
    `),
    );
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('ignores comments, blank lines, vn/vt/o/g/s/mtllib/usemtl directives', () => {
    const mesh = decodeObj(
      obj(`
# this is a comment
mtllib something.mtl
o Cube
g face

v 0 0 0  # inline comment after coords
v 1 0 0
v 0 1 0
vn 0 0 1
vt 0 0
s 1
usemtl red
f 1 2 3
    `),
    );
    expect(mesh.indices.length).toBe(3);
    expect(mesh.vertices.length).toBe(9);
  });

  it('throws on non-finite vertex coordinates', () => {
    expect(() => decodeObj(obj('v 1 NaN 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'))).toThrow(ObjDecodeError);
  });

  it('throws on face referencing an undeclared vertex', () => {
    expect(() => decodeObj(obj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99'))).toThrow(ObjDecodeError);
  });

  it('throws on a face with fewer than 3 vertices', () => {
    expect(() => decodeObj(obj('v 0 0 0\nv 1 0 0\nf 1 2'))).toThrow(ObjDecodeError);
  });

  it('throws when there are no vertices', () => {
    expect(() => decodeObj(obj('# empty\n'))).toThrow(/no "v"/);
  });

  it('throws when there are no faces', () => {
    expect(() => decodeObj(obj('v 0 0 0\nv 1 0 0\nv 0 1 0\n'))).toThrow(/no "f"/);
  });

  it('handles CRLF line endings (Windows-saved files)', () => {
    const mesh = decodeObj(obj('v 0 0 0\r\nv 1 0 0\r\nv 0 1 0\r\nf 1 2 3\r\n'));
    expect(mesh.indices.length).toBe(3);
  });
});
