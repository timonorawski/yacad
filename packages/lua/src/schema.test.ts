import { describe, expect, it } from 'vitest';
import { assertValidSchema, type LuaSchema } from './schema';

describe('assertValidSchema', () => {
  it('accepts a minimal schema', () => {
    const schema: LuaSchema = { inputs: [], params: {}, output: '3d' };
    expect(() => assertValidSchema(schema, '$')).not.toThrow();
  });

  it('rejects unknown output type', () => {
    expect(() =>
      assertValidSchema({ inputs: [], params: {}, output: '4d' as unknown as '3d' }, '$'),
    ).toThrow(/output/i);
  });

  it('rejects duplicate input names', () => {
    expect(() =>
      assertValidSchema(
        {
          inputs: [
            { name: 'a', type: '3d' },
            { name: 'a', type: '3d' },
          ],
          params: {},
          output: '3d',
        },
        '$',
      ),
    ).toThrow(/duplicate/i);
  });

  it('rejects unknown param type', () => {
    expect(() =>
      assertValidSchema(
        { inputs: [], params: { x: { type: 'object' as unknown as 'number' } }, output: '3d' },
        '$',
      ),
    ).toThrow(/param type/i);
  });
});
