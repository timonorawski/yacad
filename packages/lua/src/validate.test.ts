import { describe, expect, it } from 'vitest';
import { buildGraph } from '@yacad/dag';
import { checkInputsAgainstSchema, normalizeValues } from './validate';
import type { LuaSchema } from './schema';

const SCHEMA: LuaSchema = {
  inputs: [
    { name: 'body', type: '3d' },
    { name: 'mask', type: '3d', optional: true },
  ],
  params: {
    teeth: { type: 'int', default: 12, min: 3, max: 200 },
    pitch: { type: 'number', default: 1.0 },
    center: { type: 'boolean', default: false },
    name: { type: 'string', default: '' },
    offset: { type: 'vec3', default: [0, 0, 0] },
  },
  output: '3d',
};

describe('normalizeValues', () => {
  it('fills defaults', () => {
    expect(normalizeValues(SCHEMA, {}, '$')).toEqual({
      teeth: 12,
      pitch: 1.0,
      center: false,
      name: '',
      offset: [0, 0, 0],
    });
  });

  it('accepts user values', () => {
    expect(normalizeValues(SCHEMA, { teeth: 24, offset: [1, 2, 3] }, '$').teeth).toBe(24);
  });

  it('rejects non-integer for int', () => {
    expect(() => normalizeValues(SCHEMA, { teeth: 3.5 }, '$')).toThrow(/integer/i);
  });

  it('enforces min/max', () => {
    expect(() => normalizeValues(SCHEMA, { teeth: 2 }, '$')).toThrow(/>= 3/);
    expect(() => normalizeValues(SCHEMA, { teeth: 201 }, '$')).toThrow(/<= 200/);
  });

  it('drops unknown keys (does not throw — defensive against forward-compat documents)', () => {
    const out = normalizeValues(SCHEMA, { teeth: 12, ignored: 'x' }, '$');
    expect(out).not.toHaveProperty('ignored');
  });

  it('rejects required param missing default', () => {
    const noDefault: LuaSchema = {
      ...SCHEMA,
      params: { teeth: { type: 'int', min: 3 } },
    };
    expect(() => normalizeValues(noDefault, {}, '$')).toThrow(/required/i);
  });

  it('throws on unknown param type', () => {
    const unknownType: LuaSchema = {
      ...SCHEMA,
      params: { weird: { type: 'unknown_type' as unknown as 'int', default: 42 } },
    };
    // Pass a value (not undefined) so normalizeOne enters the switch statement
    expect(() => normalizeValues(unknownType, { weird: 'value' }, '$')).toThrow(
      /unknown param type/i,
    );
  });
});

describe('checkInputsAgainstSchema', () => {
  it('passes with correct arity and types', async () => {
    const a = await buildGraph({ type: 'box', params: { size: [1, 1, 1] } });
    const b = await buildGraph({ type: 'box', params: { size: [1, 1, 1] } });
    expect(() => checkInputsAgainstSchema(SCHEMA, [a, b], '$')).not.toThrow();
  });

  it('allows optional input absent', async () => {
    const a = await buildGraph({ type: 'box', params: { size: [1, 1, 1] } });
    expect(() => checkInputsAgainstSchema(SCHEMA, [a], '$')).not.toThrow();
  });

  it('rejects too few children when a required input is missing', () => {
    expect(() => checkInputsAgainstSchema(SCHEMA, [], '$')).toThrow(/required.*body/i);
  });

  it('rejects too many children', async () => {
    const a = await buildGraph({ type: 'box', params: { size: [1, 1, 1] } });
    expect(() => checkInputsAgainstSchema(SCHEMA, [a, a, a], '$')).toThrow(/too many/i);
  });

  it('rejects mismatched output type', async () => {
    const a = await buildGraph({ type: 'box', params: { size: [1, 1, 1] } });
    const twoD: LuaSchema = { ...SCHEMA, inputs: [{ name: 'body', type: '2d' }] };
    expect(() => checkInputsAgainstSchema(twoD, [a], '$')).toThrow(/2d/);
  });
});
