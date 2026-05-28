/**
 * Single source of truth for the Lua sandbox's allowed identifiers.
 * Consumed by both WasmoonLuaRuntime (to derive the strip script that nils
 * impure entries) and the static validator (to reject references to anything
 * outside this set).
 */
export const SANDBOX_GLOBALS: {
  /** Identifiers visible at the top level of user Lua after installSandbox. */
  readonly topLevel: ReadonlySet<string>;
  /** Per-library allowed member names. Library names absent from this map
   *  carry no member restrictions beyond existence (geo.* is registry-driven). */
  readonly libraryMembers: ReadonlyMap<string, ReadonlySet<string>>;
} = {
  topLevel: new Set<string>([
    // Library tables
    'math', 'string', 'table',
    // Injected APIs
    'geo', 'inputs', 'params',
    // Surviving base-library entries (Lua 5.1-ish base as exposed by Wasmoon)
    'assert', 'error', 'getmetatable', 'ipairs', 'next', 'pairs',
    'pcall', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select',
    'setmetatable', 'tonumber', 'tostring', 'type', 'unpack', 'xpcall',
    '_VERSION',
  ]),
  libraryMembers: new Map<string, ReadonlySet<string>>([
    ['math', new Set([
      // Lua 5.3+ math, minus randomseed (seeded by the runtime, then nilled)
      'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'deg', 'exp', 'floor',
      'fmod', 'huge', 'log', 'max', 'maxinteger', 'min', 'mininteger',
      'modf', 'pi', 'rad', 'random', 'sin', 'sqrt', 'tan', 'tointeger',
      'type', 'ult',
    ])],
    ['string', new Set([
      // Lua 5.3+ string, minus dump (bytecode export — sandbox escape risk)
      'byte', 'char', 'find', 'format', 'gmatch', 'gsub', 'len', 'lower',
      'match', 'pack', 'packsize', 'rep', 'reverse', 'sub', 'unpack', 'upper',
    ])],
    ['table', new Set([
      'concat', 'insert', 'move', 'pack', 'remove', 'sort', 'unpack',
    ])],
  ]),
};
