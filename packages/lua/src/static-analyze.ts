import * as luaparse from 'luaparse';
import type { LuaDefinition } from './schema';

export type ValidationCategory =
  | 'unparseable'
  | 'unsupported-syntax'
  | 'undeclared-param'
  | 'undeclared-input'
  | 'sandbox-violation'
  | 'unknown-geo-type'
  | 'unknown-geo-param'
  | 'missing-geo-param'
  | 'unanalyzable-alias'
  | 'unanalyzable-access';

export interface ValidationIssue {
  readonly category: ValidationCategory;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly identifier?: string;
  readonly validNames?: readonly string[];
}

export class LuaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(formatSummary(issues));
    this.name = 'LuaValidationError';
    this.issues = issues;
  }
}

function formatSummary(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return 'LuaValidationError: 0 issues';
  const head = issues
    .slice(0, 3)
    .map((i) => `line ${i.line}: ${i.message}`)
    .join('; ');
  const more = issues.length > 3 ? `; and ${issues.length - 3} more` : '';
  return `${issues.length} validation issue${issues.length === 1 ? '' : 's'}: ${head}${more}`;
}

/** Static validation of a LuaDefinition. Throws LuaValidationError if any
 *  issues are found; otherwise returns normally. Deterministic, pure, safe
 *  for editor-time use. Full implementation lands across subsequent tasks. */
export function validateLuaSource(def: LuaDefinition): void {
  const issues: ValidationIssue[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ast: any;
  try {
    ast = luaparse.parse(def.code, {
      luaVersion: '5.3',
      locations: true,
      comments: false,
      scope: false,
    });
  } catch (e) {
    issues.push(mapParseError(e));
    throw new LuaValidationError(issues);
  }

  // AST-walk phases land in Task 8+. For now, a well-parsed program produces
  // no issues.
  void ast;

  if (issues.length > 0) {
    throw new LuaValidationError(issues);
  }
}

function mapParseError(e: unknown): ValidationIssue {
  const err = e as { message?: string; line?: number; column?: number };
  const message = err.message ?? 'parse error';
  const line = typeof err.line === 'number' ? err.line : 1;
  // luaparse columns are 0-indexed; normalize to 1-indexed.
  const column = typeof err.column === 'number' ? err.column + 1 : 1;

  // Heuristic: detect Lua 5.4 attribute syntax. luaparse 5.3 mode rejects
  // `local x <const> = ...` with a message like:
  //   "[1:8] unexpected symbol '<' near 'const'"
  // The `<` token itself is the unexpected symbol, appearing just before
  // `const` or `close`. We match both the symbol token and the keyword.
  if (/unexpected symbol '<' near '(const|close)'/.test(message)) {
    return {
      category: 'unsupported-syntax',
      message: `Lua 5.4 attributes (<const>/<close>) are not supported; use a plain local. (${message})`,
      line,
      column,
    };
  }

  return {
    category: 'unparseable',
    message,
    line,
    column,
  };
}
