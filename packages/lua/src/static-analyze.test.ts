import { describe, it, expect } from 'vitest';
import { LuaValidationError, type ValidationIssue } from './static-analyze';

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
