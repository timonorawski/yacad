import { describe, it, expect } from 'vitest';
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
    const issues = Array.from({ length: 7 }, (_, i) =>
      sample({ message: `m${i}`, line: i + 1 })
    );
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
