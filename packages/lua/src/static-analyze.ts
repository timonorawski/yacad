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

  const scope = new Scope();
  const tainted = new Set<string>();
  walkPhase1(ast, scope, tainted, issues);

  // Phase 2 walker lands in subsequent tasks. For now, only Phase 1 issues
  // are collected.

  if (issues.length > 0) {
    throw new LuaValidationError(issues);
  }
}

/** Lexical scope tracker. Each frame is a Set<name> of locals declared in
 *  that frame. Functions and blocks push new frames. Lookup walks the stack
 *  from innermost outward; falls through to SANDBOX_GLOBALS.topLevel for
 *  the global tier (resolution happens in walkers, not here). */
class Scope {
  private readonly frames: Set<string>[] = [new Set()];

  push(): void {
    this.frames.push(new Set());
  }
  pop(): void {
    if (this.frames.length <= 1) throw new Error('scope underflow');
    this.frames.pop();
  }
  declareLocal(name: string): void {
    this.frames[this.frames.length - 1]!.add(name);
  }
  isLocal(name: string): boolean {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i]!.has(name)) return true;
    }
    return false;
  }
}

interface LocNode {
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
}

function locOf(n: LocNode): { line: number; column: number } {
  return n.loc
    ? { line: n.loc.start.line, column: n.loc.start.column + 1 }
    : { line: 1, column: 1 };
}

const SENTINEL_TABLES = new Set(['params', 'inputs', 'geo']);

function walkPhase1(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ast: any,
  scope: Scope,
  tainted: Set<string>,
  issues: ValidationIssue[],
): void {
  visit(ast);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visit(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    switch (node.type) {
      case 'Chunk':
        for (const s of node.body) visit(s);
        return;

      case 'LocalStatement': {
        // For each `local name = init`, decide taint based on init expression.
        for (let i = 0; i < node.variables.length; i++) {
          const variable = node.variables[i];
          const init = node.init?.[i];
          if (init && isAliasExpr(init)) {
            issues.push({
              category: 'unanalyzable-alias',
              message: aliasMessage(init),
              ...locOf(variable),
              identifier: variable.name,
            });
            tainted.add(variable.name);
          }
          scope.declareLocal(variable.name);
        }
        return;
      }

      case 'FunctionDeclaration': {
        // Parameter names become locals in a new frame.
        scope.push();
        for (const p of node.parameters ?? []) {
          if (p.type === 'Identifier') scope.declareLocal(p.name);
        }
        for (const s of node.body ?? []) visit(s);
        scope.pop();
        return;
      }

      case 'DoStatement':
      case 'WhileStatement':
      case 'RepeatStatement':
      case 'IfStatement':
      case 'ForNumericStatement':
      case 'ForGenericStatement': {
        scope.push();
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
        scope.pop();
        return;
      }

      default: {
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAliasExpr(expr: any): boolean {
  if (!expr) return false;
  if (expr.type === 'Identifier' && SENTINEL_TABLES.has(expr.name)) return true;
  // Phase 1 catches `local b = geo.something` too — handled in Task 9.
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aliasMessage(expr: any): string {
  const name = expr.name ?? 'sentinel';
  return `aliasing '${name}' to a local defeats static analysis; use direct access instead`;
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
