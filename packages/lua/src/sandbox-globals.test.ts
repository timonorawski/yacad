import { describe, it, expect } from 'vitest';
import { SANDBOX_GLOBALS } from './sandbox-globals';

describe('SANDBOX_GLOBALS.topLevel', () => {
  it('includes the three library tables', () => {
    expect(SANDBOX_GLOBALS.topLevel.has('math')).toBe(true);
    expect(SANDBOX_GLOBALS.topLevel.has('string')).toBe(true);
    expect(SANDBOX_GLOBALS.topLevel.has('table')).toBe(true);
  });

  it('includes the three injected APIs', () => {
    expect(SANDBOX_GLOBALS.topLevel.has('geo')).toBe(true);
    expect(SANDBOX_GLOBALS.topLevel.has('inputs')).toBe(true);
    expect(SANDBOX_GLOBALS.topLevel.has('params')).toBe(true);
  });

  it('includes base-library entries that survive the strip', () => {
    for (const name of [
      'assert', 'error', 'getmetatable', 'ipairs', 'next', 'pairs',
      'pcall', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select',
      'setmetatable', 'tonumber', 'tostring', 'type', 'xpcall',
    ]) {
      expect(SANDBOX_GLOBALS.topLevel.has(name)).toBe(true);
    }
  });

  it('excludes stripped base-library entries', () => {
    for (const name of [
      'dofile', 'loadfile', 'load', 'loadstring', 'require',
      'print', 'collectgarbage',
    ]) {
      expect(SANDBOX_GLOBALS.topLevel.has(name)).toBe(false);
    }
  });

  it('excludes the dynamic-global escape hatches', () => {
    expect(SANDBOX_GLOBALS.topLevel.has('_G')).toBe(false);
    expect(SANDBOX_GLOBALS.topLevel.has('_ENV')).toBe(false);
  });
});
