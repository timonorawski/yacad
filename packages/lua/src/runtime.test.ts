import { describe, expect, it } from 'vitest';
import { LuaError } from './runtime';

describe('LuaError', () => {
  it('exposes phase and optional line/col', () => {
    const e = new LuaError('boom', { phase: 'runtime', line: 3 });
    expect(e.name).toBe('LuaError');
    expect(e.phase).toBe('runtime');
    expect(e.line).toBe(3);
  });

  it('threads a cause for output errors', () => {
    const cause = new Error('inner');
    const e = new LuaError('wrap', { phase: 'output', cause });
    expect(e.cause).toBe(cause);
  });
});
