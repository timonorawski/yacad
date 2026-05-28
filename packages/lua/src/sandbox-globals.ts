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

/**
 * Lua source executed by the runtime AFTER loadLibrary(Base|Math|String|Table)
 * to nil out every identifier brought in by those libraries that is NOT in the
 * whitelist. Derived once at module load from SANDBOX_GLOBALS so the runtime
 * and validator cannot drift.
 *
 * The script does NOT nil entries that aren't in the loaded libraries to begin
 * with (e.g., `os` isn't loaded so doesn't need stripping).
 */
export const SANDBOX_STRIP_SCRIPT: string = (() => {
  // Entries that Wasmoon's LuaLibraries.Base brings in. Pinned here rather than
  // discovered at runtime because the validator runs without Wasmoon.
  const baseLibrary = new Set<string>([
    'assert', 'collectgarbage', 'dofile', 'error', 'getmetatable',
    'ipairs', 'load', 'loadfile', 'loadstring', 'next', 'pairs',
    'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset',
    'require', 'select', 'setmetatable', 'tonumber', 'tostring',
    'type', 'unpack', 'xpcall', '_G', '_VERSION',
  ]);

  // Library member sets as opened by loadLibrary, minus our whitelist.
  const libraryAvailable = new Map<string, ReadonlySet<string>>([
    ['math', new Set([
      'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'deg', 'exp', 'floor',
      'fmod', 'huge', 'log', 'max', 'maxinteger', 'min', 'mininteger',
      'modf', 'pi', 'rad', 'random', 'randomseed', 'sin', 'sqrt', 'tan',
      'tointeger', 'type', 'ult',
    ])],
    ['string', new Set([
      'byte', 'char', 'dump', 'find', 'format', 'gmatch', 'gsub', 'len',
      'lower', 'match', 'pack', 'packsize', 'rep', 'reverse', 'sub',
      'unpack', 'upper',
    ])],
    ['table', new Set([
      'concat', 'insert', 'move', 'pack', 'remove', 'sort', 'unpack',
    ])],
  ]);

  const lines: string[] = [];

  // Strip top-level base entries not in the whitelist.
  for (const name of baseLibrary) {
    if (!SANDBOX_GLOBALS.topLevel.has(name)) {
      lines.push(`${name} = nil`);
    }
  }

  // Strip per-library members not in the per-library whitelist.
  for (const [libName, available] of libraryAvailable) {
    const allowed = SANDBOX_GLOBALS.libraryMembers.get(libName) ?? new Set();
    for (const member of available) {
      if (!allowed.has(member)) {
        lines.push(`${libName}.${member} = nil`);
      }
    }
  }

  return lines.join('\n');
})();
