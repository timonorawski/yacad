/**
 * Showcase: parametric (p, q) torus knot.
 *
 * Demonstrates the new `warp` kernel transform. A 2D circle is revolved into
 * a plain torus, then a Lua-defined vertex deformation wraps that torus
 * around itself p times through the donut hole and q times around the donut
 * — the standard (p, q) torus-knot construction.
 *
 * Ported from Manifold's "Matlab Knot" example (Emmett Lalish, MIT-licensed).
 * In the original JS, the warp function captures p, q and the radii from
 * outer scope; here we pass them through `params.values` so they participate
 * in the cache hash like any other DAG parameter.
 */
import { canonicalBytes } from '@yacad/canonical';
import type { NodeDoc } from '@yacad/dag';
import type { DocLibrary } from '@yacad/doc-store';
import { defaultHasher } from '@yacad/hash';
import type { LuaDefinition } from '@yacad/lua';

export const TORUS_KNOT_DEFINITION: LuaDefinition = {
  schema: {
    inputs: [],
    params: {
      p: { type: 'int', default: 1, min: 1, max: 8 },
      q: { type: 'int', default: 3, min: 1, max: 8 },
      majorRadius: { type: 'number', default: 25 },
      minorRadius: { type: 'number', default: 10 },
      threadRadius: { type: 'number', default: 3.75 },
      circularSegments: { type: 'int', default: 24, min: 3, max: 64 },
    },
    output: '3d',
  },
  code: [
    "-- Greatest common divisor (Lua doesn't have one built in).",
    'local function gcd(a, b)',
    '  while b ~= 0 do a, b = b, a % b end',
    '  return a',
    'end',
    '',
    'local kLoops = gcd(params.p, params.q)',
    'local pk = params.p / kLoops',
    'local qk = params.q / kLoops',
    'local offset = 2',
    '-- Linear segments along the knot length: roughly square facets.',
    'local m = math.max(',
    '  8,',
    '  math.floor(params.circularSegments * qk * params.majorRadius / params.threadRadius)',
    ')',
    '',
    '-- 2D cross-section: a small circle at x = offset from the revolve axis.',
    '-- Revolving gives a plain torus that the warp then deforms into a knot.',
    'local profile = geo.translate_2d(',
    '  { offset = { offset, 0 } },',
    '  { geo.circle({ radius = 1, segments = params.circularSegments }) }',
    ')',
    'local torus = geo.revolve({ segments = m }, { profile })',
    '',
    '-- Warp the plain torus into a (p, q) knot. The Lua code runs per-vertex',
    "-- inside the kernel's sandboxed Lua engine, with the captured values",
    '-- available as `params`.',
    'local warp_code = [[',
    '  local pk = params.pk',
    '  local qk = params.qk',
    '  local majorRadius = params.majorRadius',
    '  local minorRadius = params.minorRadius',
    '  local threadRadius = params.threadRadius',
    '  local offset = params.offset',
    '',
    '  -- Lua 5.3+ math.atan(y, x) is two-arg atan2; the original JS uses',
    '  -- atan2(v[0], v[1]) i.e. atan2(x_in, y_in), so we pass them in that order.',
    '  local psi = qk * math.atan(x, y)',
    '  local theta = psi * pk / qk',
    '  local x1 = math.sqrt(x * x + y * y)',
    '  local phi = math.atan(x1 - offset, z)',
    '  local px = threadRadius * math.cos(phi)',
    '  local pz0 = threadRadius * math.sin(phi)',
    '',
    '  -- rotate (0, pz0) by -atan(pk*minor, qk*r) where r = major + minor*cos(theta)',
    '  local r = majorRadius + minorRadius * math.cos(theta)',
    '  local a1 = -math.atan(pk * minorRadius, qk * r)',
    '  local c1, s1 = math.cos(a1), math.sin(a1)',
    '  local py = -pz0 * s1',
    '  local pz = pz0 * c1',
    '',
    '  -- shift radially, then rotate (x, z) by -theta',
    '  local x2 = px + minorRadius',
    '  local a2 = -theta',
    '  local c2, s2 = math.cos(a2), math.sin(a2)',
    '  local x3 = x2 * c2 - pz * s2',
    '  local z3 = x2 * s2 + pz * c2',
    '',
    '  -- final rotation around the donut by psi',
    '  local x4 = x3 + majorRadius',
    '  local c3, s3 = math.cos(psi), math.sin(psi)',
    '  return x4 * c3 - py * s3, x4 * s3 + py * c3, z3',
    ']]',
    '',
    'return geo.warp(',
    '  {',
    '    code = warp_code,',
    '    values = {',
    '      pk = pk,',
    '      qk = qk,',
    '      majorRadius = params.majorRadius,',
    '      minorRadius = params.minorRadius,',
    '      threadRadius = params.threadRadius,',
    '      offset = offset,',
    '    },',
    '  },',
    '  { torus }',
    ')',
  ].join('\n'),
};

/**
 * Seed a default torus-knot scene into the supplied library. The Lua
 * definition blob is content-addressed and registered with the session so
 * the worker can resolve it on first evaluate.
 */
export async function seedTorusKnotShowcase(library: DocLibrary): Promise<void> {
  const defBytes = canonicalBytes(TORUS_KNOT_DEFINITION);
  const defHash = await defaultHasher.hash(defBytes);
  const doc: NodeDoc = {
    type: 'lua',
    params: {
      definitionHash: defHash,
      values: {
        p: 1,
        q: 3,
        majorRadius: 25,
        minorRadius: 10,
        threadRadius: 3.75,
        circularSegments: 24,
      },
    },
  };
  const session = await library.create('Showcase: torus knot (warp)', doc, {
    skipValidation: true,
  });
  await session.addBlob(defBytes);
  await session.save();
  await session.close();
}
