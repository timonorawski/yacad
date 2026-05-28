import { describe, it, expect } from 'vitest';
import { registerNodeType, unregisterNodeType, type DecoderNodeType } from '@yacad/dag';
import { LuaValidationError, validateLuaSource, type ValidationIssue } from './static-analyze';
import type { LuaDefinition } from './schema';

const emptySchema = { inputs: [], params: {}, output: '3d' as const };
const def = (code: string): LuaDefinition => ({ schema: emptySchema, code });

describe('LuaValidationError', () => {
  const sample = (over: Partial<ValidationIssue> = {}): ValidationIssue => ({
    category: 'sandbox-violation',
    message: 'unknown identifier',
    line: 1,
    column: 0,
    ...over,
  });

  it('exposes the issues array unchanged', () => {
    const issues = [sample({ message: 'A' }), sample({ message: 'B' })];
    const err = new LuaValidationError(issues);
    expect(err.issues).toEqual(issues);
    expect(err.name).toBe('LuaValidationError');
    expect(err).toBeInstanceOf(Error);
  });

  it('summarizes first three issues in the message', () => {
    const issues = [
      sample({ message: 'first', line: 2 }),
      sample({ message: 'second', line: 5 }),
      sample({ message: 'third', line: 9 }),
    ];
    const err = new LuaValidationError(issues);
    expect(err.message).toContain('first');
    expect(err.message).toContain('second');
    expect(err.message).toContain('third');
    expect(err.message).toMatch(/line 2/);
    expect(err.message).not.toMatch(/and \d+ more/);
  });

  it('truncates after three issues with "and N more"', () => {
    const issues = Array.from({ length: 7 }, (_, i) => sample({ message: `m${i}`, line: i + 1 }));
    const err = new LuaValidationError(issues);
    expect(err.message).toContain('m0');
    expect(err.message).toContain('m1');
    expect(err.message).toContain('m2');
    expect(err.message).not.toContain('m3');
    expect(err.message).toMatch(/and 4 more/);
  });
});

describe('parse errors', () => {
  it('catches syntax errors as unparseable', () => {
    try {
      validateLuaSource(def('local x = '));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(LuaValidationError);
      const err = e as LuaValidationError;
      expect(err.issues.length).toBe(1);
      expect(err.issues[0]!.category).toBe('unparseable');
      expect(err.issues[0]!.line).toBeGreaterThan(0);
    }
  });

  it('flags Lua 5.4 <const> as unsupported-syntax', () => {
    try {
      validateLuaSource(def('local x <const> = 1\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues[0]!.category).toBe('unsupported-syntax');
      expect(err.issues[0]!.message).toMatch(/Lua 5\.4|<const>|attribute/i);
    }
  });

  it('passes well-formed empty programs without throwing', () => {
    expect(() => validateLuaSource(def('return { type = "box" }'))).not.toThrow();
  });
});

describe('Phase 1 — direct aliases', () => {
  it('rejects local p = params', () => {
    try {
      validateLuaSource(def('local p = params\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const aliases = err.issues.filter((i) => i.category === 'unanalyzable-alias');
      expect(aliases.length).toBe(1);
      expect(aliases[0]!.identifier).toBe('p');
      expect(aliases[0]!.line).toBe(1);
    }
  });

  it('rejects local i = inputs and local g = geo', () => {
    try {
      validateLuaSource(
        def(['local i = inputs', 'local g = geo', 'return { type = "box" }'].join('\n')),
      );
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const aliases = err.issues.filter((i) => i.category === 'unanalyzable-alias');
      expect(aliases.length).toBe(2);
      expect(aliases.map((a) => a.identifier).sort()).toEqual(['g', 'i']);
    }
  });

  it('does NOT flag local p = params.teeth (field read, not table alias)', () => {
    const d: LuaDefinition = {
      schema: { inputs: [], params: { teeth: { type: 'int', default: 8 } }, output: '3d' },
      code: 'local p = params.teeth\nreturn { type = "box" }',
    };
    expect(() => validateLuaSource(d)).not.toThrow();
  });
});

describe('Phase 1 — geo.X aliases', () => {
  it('rejects local b = geo.box', () => {
    try {
      validateLuaSource(def('local b = geo.box\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const aliases = err.issues.filter((i) => i.category === 'unanalyzable-alias');
      expect(aliases.length).toBe(1);
      expect(aliases[0]!.identifier).toBe('b');
    }
  });

  it('rejects local r = geo.rotate (any geo member, not just kernel types)', () => {
    try {
      validateLuaSource(def('local r = geo.rotate\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'unanalyzable-alias')).toBe(true);
    }
  });

  it('rejects local n = geo.node (the dynamic-dispatch primitive)', () => {
    try {
      validateLuaSource(def('local n = geo.node\nreturn { type = "box" }'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'unanalyzable-alias')).toBe(true);
    }
  });
});

describe('Phase 2 — sandbox identifier check', () => {
  it('flags os/io/require/load/dofile/print/_G/_ENV as sandbox-violation', () => {
    for (const id of ['os', 'io', 'require', 'load', 'dofile', 'print', '_G', '_ENV']) {
      try {
        validateLuaSource(def(`return ${id}`));
        throw new Error(`expected throw for ${id}`);
      } catch (e) {
        const err = e as LuaValidationError;
        const sv = err.issues.filter((i) => i.category === 'sandbox-violation');
        expect(sv.length).toBeGreaterThan(0);
        expect(sv.some((i) => i.identifier === id)).toBe(true);
      }
    }
  });

  it('allows whitelisted identifiers', () => {
    for (const id of ['math', 'string', 'table', 'pairs', 'ipairs', 'pcall', 'tostring', 'type']) {
      const d = def(`local x = ${id}\nreturn { type = "box" }`);
      expect(() => validateLuaSource(d)).not.toThrow();
    }
  });

  it('does not double-report on tainted locals', () => {
    try {
      validateLuaSource(def('local p = params\nreturn p.foo'));
    } catch (e) {
      const err = e as LuaValidationError;
      const aliases = err.issues.filter((i) => i.category === 'unanalyzable-alias');
      const sv = err.issues.filter((i) => i.category === 'sandbox-violation');
      expect(aliases.length).toBe(1);
      expect(sv.length).toBe(0);
    }
  });
});

describe('Phase 2 — params/inputs member checks', () => {
  const teethSchema = {
    inputs: [],
    params: {
      teeth: { type: 'int' as const, default: 8 },
      radius: { type: 'number' as const, default: 5 },
    },
    output: '3d' as const,
  };

  it('allows declared params', () => {
    expect(() =>
      validateLuaSource({
        schema: teethSchema,
        code: 'return { type = "box", params = { size = { params.teeth, params.radius, 1 } } }',
      }),
    ).not.toThrow();
  });

  it('flags undeclared params with validNames', () => {
    try {
      validateLuaSource({
        schema: teethSchema,
        code: 'return { type = "box", params = { x = params.tooth } }',
      });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'undeclared-param');
      expect(u).toBeDefined();
      expect(u!.identifier).toBe('tooth');
      expect(u!.validNames).toEqual(['teeth', 'radius']);
    }
  });

  const bodySchema = {
    inputs: [{ name: 'body', type: '3d' as const }],
    params: {},
    output: '3d' as const,
  };

  it('allows declared inputs', () => {
    expect(() =>
      validateLuaSource({
        schema: bodySchema,
        code: 'return { type = "translate", params = {}, children = { inputs.body } }',
      }),
    ).not.toThrow();
  });

  it('flags undeclared inputs with validNames', () => {
    try {
      validateLuaSource({
        schema: bodySchema,
        code: 'return { type = "translate", children = { inputs.head } }',
      });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'undeclared-input');
      expect(u).toBeDefined();
      expect(u!.identifier).toBe('head');
      expect(u!.validNames).toEqual(['body']);
    }
  });
});

describe('Phase 2 — geo.X member checks', () => {
  it('allows a registered kernel type', () => {
    expect(() => validateLuaSource(def('return geo.box({ size = { 1, 1, 1 } })'))).not.toThrow();
  });

  it('flags an unknown geo.X as unknown-geo-type', () => {
    try {
      validateLuaSource(def('return geo.bogus({})'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'unknown-geo-type');
      expect(u).toBeDefined();
      expect(u!.identifier).toBe('bogus');
    }
  });

  it('allows geo.node (the dynamic-dispatch primitive)', () => {
    // geo.node({...}) is the underlying primitive; it's a real geo entry
    // even though it's not in the registry. Don't flag it.
    expect(() =>
      validateLuaSource(def('return geo.node("box", { size = { 1, 1, 1 } })')),
    ).not.toThrow();
  });
});

describe('Phase 2 — geo.<type> call shape', () => {
  it('allows a valid call', () => {
    expect(() => validateLuaSource(def('return geo.box({ size = { 1, 1, 1 } })'))).not.toThrow();
  });

  it('flags unknown param keys with validNames', () => {
    try {
      validateLuaSource(def('return geo.box({ size = { 1, 1, 1 }, bogus = 5 })'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'unknown-geo-param');
      expect(u).toBeDefined();
      expect(u!.identifier).toBe('bogus');
      expect(u!.validNames!.length).toBeGreaterThan(0);
      expect(u!.validNames!).toContain('size');
    }
  });

  it('flags missing required params', () => {
    try {
      validateLuaSource(def('return geo.box({})'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const u = err.issues.find((i) => i.category === 'missing-geo-param');
      expect(u).toBeDefined();
      expect(u!.validNames!).toContain('size');
    }
  });

  it('flags non-table first arg as unanalyzable-access', () => {
    try {
      validateLuaSource(def('local p = { size = { 1, 1, 1 } }\nreturn geo.box(p)'));
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'unanalyzable-access')).toBe(true);
    }
  });

  it('passes loop-built children (children arg is unchecked)', () => {
    const d = def(
      [
        'local parts = {}',
        'for i = 1, 3 do',
        '  parts[#parts + 1] = geo.box({ size = { 1, 1, 1 } })',
        'end',
        'return geo.union({}, parts)',
      ].join('\n'),
    );
    expect(() => validateLuaSource(d)).not.toThrow();
  });

  it('handles table-call syntax geo.box{...}', () => {
    expect(() => validateLuaSource(def('return geo.box{ size = { 1, 1, 1 } }'))).not.toThrow();
  });
});

describe('Phase 2 — params[K] / inputs[K] index access', () => {
  const teethSchema = {
    inputs: [],
    params: { teeth: { type: 'int' as const, default: 8 } },
    output: '3d' as const,
  };

  it('allows literal-key bracket access on params', () => {
    expect(() =>
      validateLuaSource({
        schema: teethSchema,
        code: 'return { type = "box", params = { x = params["teeth"] } }',
      }),
    ).not.toThrow();
  });

  it('flags non-literal-key bracket access as unanalyzable-access', () => {
    try {
      validateLuaSource({
        schema: teethSchema,
        code: 'local k = "teeth"\nreturn { type = "box", params = { x = params[k] } }',
      });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'unanalyzable-access')).toBe(true);
    }
  });

  it('flags literal bracket key not in schema as undeclared-param', () => {
    try {
      validateLuaSource({
        schema: teethSchema,
        code: 'return { type = "box", params = { x = params["tooth"] } }',
      });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(err.issues.some((i) => i.category === 'undeclared-param')).toBe(true);
    }
  });
});

describe('scope handling', () => {
  it('shadowing: local params silently overrides the sandbox params', () => {
    const d = def(
      [
        'local params = { teeth = 8 }',
        'return { type = "box", params = { size = { params.teeth, 1, 1 } } }',
      ].join('\n'),
    );
    expect(() => validateLuaSource(d)).not.toThrow();
  });

  it('nested function params shadow correctly', () => {
    const d = def(
      [
        'local function f(params)',
        '  return params.x',
        'end',
        'return { type = "box", params = { size = { f({ x = 1 }), 1, 1 } } }',
      ].join('\n'),
    );
    expect(() => validateLuaSource(d)).not.toThrow();
  });

  it('for-loop variable scoped to the loop body', () => {
    const d = def(
      [
        'for i = 1, 3 do',
        '  local x = i',
        'end',
        'return { type = "box", params = { size = { i, 1, 1 } } }',
      ].join('\n'),
    );
    try {
      validateLuaSource(d);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      expect(
        err.issues.some((iss) => iss.category === 'sandbox-violation' && iss.identifier === 'i'),
      ).toBe(true);
    }
  });
});

describe('multi-issue collection', () => {
  it('collects issues across categories in source order', () => {
    const teethSchema = {
      inputs: [{ name: 'body', type: '3d' as const }],
      params: { teeth: { type: 'int' as const, default: 8 } },
      output: '3d' as const,
    };
    const code = [
      'local p = params', // line 1 — unanalyzable-alias
      'local bad = os.time()', // line 2 — sandbox-violation 'os'
      'local bogus = inputs.head', // line 3 — undeclared-input
      'return geo.bogus({ size = { params.tooth, 1, 1 } })', // line 4 — unknown-geo-type + undeclared-param
    ].join('\n');
    try {
      validateLuaSource({ schema: teethSchema, code });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as LuaValidationError;
      const cats = new Set(err.issues.map((i) => i.category));
      expect(cats.has('unanalyzable-alias')).toBe(true);
      expect(cats.has('sandbox-violation')).toBe(true);
      expect(cats.has('undeclared-input')).toBe(true);
      expect(cats.has('unknown-geo-type')).toBe(true);
      const lines = err.issues.map((i) => i.line);
      const sorted = [...lines].sort((a, b) => a - b);
      expect(lines).toEqual(sorted);
    }
  });
});

describe('geo.<type> mirrors buildGeoApi (kernel + decoder, hyphen→underscore)', () => {
  // A hyphenated decoder type, registered the way the import-* packages do.
  // buildGeoApi exposes it in Lua as geo.syn_decoder (hyphens → underscores),
  // so the validator must accept that name even though it's not a kernel type.
  const synDecoder: DecoderNodeType = {
    kind: 'decoder',
    type: 'syn-decoder',
    output: '3d',
    checkChildren() {},
    normalizeParams: (p) => (p ?? {}) as Record<string, unknown>,
  };

  it('accepts a decoder-backed geo binding (underscored)', () => {
    registerNodeType(synDecoder);
    try {
      expect(() =>
        validateLuaSource(def(`return geo.syn_decoder({ blobHash = 'abc' })`)),
      ).not.toThrow();
    } finally {
      unregisterNodeType('syn-decoder');
    }
  });

  it('still flags a genuinely unregistered geo type', () => {
    expect(() => validateLuaSource(def('return geo.bogus({})'))).toThrow(LuaValidationError);
  });
});
