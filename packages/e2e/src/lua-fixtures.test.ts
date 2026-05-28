import { describe, it, expect } from 'vitest';
import { validateLuaSource } from '@yacad/lua';
import { GEAR_DEFINITION, ARRAY_ALONG_X_DEFINITION, FLOWER_DEFINITION } from './fixtures';

describe('existing Lua fixtures validate clean', () => {
  it.each([
    ['gear', GEAR_DEFINITION],
    ['array-along-x', ARRAY_ALONG_X_DEFINITION],
    ['flower', FLOWER_DEFINITION],
  ])('%s', (_, def) => {
    expect(() => validateLuaSource(def)).not.toThrow();
  });
});
