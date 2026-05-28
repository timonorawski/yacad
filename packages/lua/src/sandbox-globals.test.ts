import { describe, it, expect } from 'vitest';
import { SANDBOX_GLOBALS, SANDBOX_STRIP_SCRIPT } from './sandbox-globals';

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

describe('SANDBOX_GLOBALS.libraryMembers', () => {
  it('math allows common functions but excludes randomseed', () => {
    const math = SANDBOX_GLOBALS.libraryMembers.get('math');
    expect(math).toBeDefined();
    for (const name of ['abs', 'ceil', 'cos', 'floor', 'max', 'min', 'pi', 'random', 'sin', 'sqrt']) {
      expect(math!.has(name)).toBe(true);
    }
    expect(math!.has('randomseed')).toBe(false);
  });

  it('string allows common functions but excludes dump', () => {
    const str = SANDBOX_GLOBALS.libraryMembers.get('string');
    expect(str).toBeDefined();
    for (const name of ['byte', 'char', 'find', 'format', 'gmatch', 'gsub', 'len', 'sub']) {
      expect(str!.has(name)).toBe(true);
    }
    expect(str!.has('dump')).toBe(false);
  });

  it('table allows all standard members', () => {
    const tbl = SANDBOX_GLOBALS.libraryMembers.get('table');
    expect(tbl).toBeDefined();
    for (const name of ['concat', 'insert', 'remove', 'sort', 'unpack']) {
      expect(tbl!.has(name)).toBe(true);
    }
  });
});

describe('SANDBOX_STRIP_SCRIPT', () => {
  it('nils out every base-library entry NOT in topLevel that Wasmoon loads', () => {
    for (const name of ['dofile', 'loadfile', 'load', 'loadstring', 'require', 'print', 'collectgarbage']) {
      expect(SANDBOX_STRIP_SCRIPT).toMatch(new RegExp(`^${name}\\s*=\\s*nil\\s*$`, 'm'));
    }
  });

  it('nils math.randomseed (stripped after the runtime seeds it)', () => {
    expect(SANDBOX_STRIP_SCRIPT).toMatch(/^math\.randomseed\s*=\s*nil\s*$/m);
  });

  it('nils string.dump', () => {
    expect(SANDBOX_STRIP_SCRIPT).toMatch(/^string\.dump\s*=\s*nil\s*$/m);
  });

  it('does NOT nil anything in topLevel', () => {
    for (const name of SANDBOX_GLOBALS.topLevel) {
      expect(SANDBOX_STRIP_SCRIPT).not.toMatch(new RegExp(`^${name}\\s*=\\s*nil`, 'm'));
    }
  });
});
