import * as luaparse from 'luaparse';
import { getKernelTypeDoc, listNodeTypes } from '@yacad/dag';
import type { LuaDefinition } from './schema';
import { SANDBOX_GLOBALS } from './sandbox-globals';

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
      encodingMode: 'pseudo-latin1',
    });
  } catch (e) {
    issues.push(mapParseError(e));
    throw new LuaValidationError(issues);
  }

  const scope = new Scope();
  const tainted = new Set<string>();
  walkPhase1(ast, scope, tainted, issues);

  walkPhase2(ast, scope, tainted, issues, def);

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
        // For `local function f(...)`, declare `f` in the OUTER scope first,
        // so callers of `f` see it as a local after the declaration.
        if (node.isLocal && node.identifier?.type === 'Identifier') {
          scope.declareLocal(node.identifier.name as string);
        }
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
  // geo.<anything> aliased to a local — defeats call-shape checks.
  if (
    expr.type === 'MemberExpression' &&
    expr.indexer === '.' &&
    expr.base?.type === 'Identifier' &&
    expr.base.name === 'geo'
  ) {
    return true;
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aliasMessage(expr: any): string {
  if (expr.type === 'Identifier') {
    return `aliasing '${expr.name}' to a local defeats static analysis; use direct access instead`;
  }
  if (expr.type === 'MemberExpression') {
    const member = expr.identifier?.name ?? '?';
    return `aliasing 'geo.${member}' to a local defeats call-shape checks; call 'geo.${member}{...}' directly instead`;
  }
  return 'unanalyzable alias';
}

function walkPhase2(
  ast: luaparse.Chunk,
  scope: Scope,
  tainted: Set<string>,
  issues: ValidationIssue[],
  def: LuaDefinition,
): void {
  // Re-walk; scope state is shared with Phase 1's stack but rebuilt as we
  // descend (Phase 1 left it at the root frame).
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
        // Locals are added to scope; init expressions are visited so nested
        // sandbox checks still happen (e.g., `local x = print()` flags print).
        for (let i = 0; i < node.variables.length; i++) {
          if (node.init?.[i]) visit(node.init[i]);
          scope.declareLocal(node.variables[i].name);
        }
        return;
      }

      case 'FunctionDeclaration': {
        // For `local function f(...)`, declare `f` in the OUTER scope first,
        // so callers of `f` see it as a local after the declaration.
        if (node.isLocal && node.identifier?.type === 'Identifier') {
          scope.declareLocal(node.identifier.name as string);
        }
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
      case 'IfStatement': {
        scope.push();
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
        scope.pop();
        return;
      }

      case 'ForNumericStatement': {
        scope.push();
        // Declare the numeric loop variable before visiting the body.
        if (node.variable?.type === 'Identifier') {
          scope.declareLocal(node.variable.name as string);
        }
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
        scope.pop();
        return;
      }

      case 'ForGenericStatement': {
        scope.push();
        // Declare all generic loop variables before visiting the body.
        for (const v of node.variables ?? []) {
          if (v.type === 'Identifier') scope.declareLocal(v.name as string);
        }
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc') continue;
          visit(node[key]);
        }
        scope.pop();
        return;
      }

      case 'CallExpression':
      case 'TableCallExpression':
      case 'StringCallExpression': {
        // Walk base and args normally for nested checks.
        visit(node.base);
        const args = argsOf(node);
        for (const a of args) visit(a);
        // Inspect geo.<type> calls for call-shape validity.
        if (isGeoTypeCall(node)) {
          checkGeoCallShape(node, args);
        }
        return;
      }

      case 'TableKeyString': {
        // The key is a literal field name, not a free variable; only visit the value.
        visit(node.value);
        return;
      }

      case 'IndexExpression': {
        visit(node.base);
        visit(node.index);
        if (node.base?.type === 'Identifier' && !scope.isLocal(node.base.name)) {
          const baseName = node.base.name as string;
          if (baseName === 'params' || baseName === 'inputs' || baseName === 'geo') {
            if (node.index?.type === 'StringLiteral') {
              // Literal key — treat as MemberExpression with that name.
              const member = node.index.value as string;
              if (baseName === 'params') checkParamMember(member, node.index);
              else if (baseName === 'inputs') checkInputMember(member, node.index);
              // geo[<literal>] handled in Task 13's geo-member dispatch.
            } else {
              issues.push({
                category: 'unanalyzable-access',
                message: `'${baseName}[...]' with a non-literal key cannot be statically checked`,
                ...locOf(node),
              });
            }
          }
        }
        return;
      }

      case 'MemberExpression': {
        // Walk base normally for nested checks (e.g., os.time → os is flagged
        // by the Identifier case).
        visit(node.base);
        // Special handling for params.X / inputs.X / geo.X / library.X.
        if (node.base?.type === 'Identifier' && !scope.isLocal(node.base.name)) {
          const baseName = node.base.name as string;
          const member = node.identifier?.name as string | undefined;
          if (member !== undefined) {
            if (baseName === 'params') checkParamMember(member, node);
            else if (baseName === 'inputs') checkInputMember(member, node);
            else if (baseName === 'geo' && member !== 'node') {
              checkGeoType(member, node);
            } else if (SANDBOX_GLOBALS.libraryMembers.has(baseName)) {
              checkLibraryMember(baseName, member, node);
            }
          }
        }
        return;
      }

      case 'Identifier': {
        // Free identifier (not part of MemberExpression index / LocalStatement
        // declarator — those cases skip this by handling Identifier inline).
        checkIdentifier(node);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function checkParamMember(name: string, node: any): void {
    const valid = Object.keys(def.schema.params);
    if (valid.includes(name)) return;
    issues.push({
      category: 'undeclared-param',
      message: `param '${name}' is not declared in schema.params`,
      ...locOf(node.identifier ?? node),
      identifier: name,
      validNames: valid,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function checkInputMember(name: string, node: any): void {
    const valid = def.schema.inputs.map((i) => i.name);
    if (valid.includes(name)) return;
    issues.push({
      category: 'undeclared-input',
      message: `input '${name}' is not declared in schema.inputs`,
      ...locOf(node.identifier ?? node),
      identifier: name,
      validNames: valid,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function checkGeoType(typeName: string, node: any): void {
    if (getKernelTypeDoc(typeName) !== undefined) return;
    issues.push({
      category: 'unknown-geo-type',
      message: `'geo.${typeName}' is not a registered kernel node type`,
      ...locOf(node.identifier ?? node),
      identifier: typeName,
      validNames: listNodeTypes()
        .filter((d) => getKernelTypeDoc(d.type) !== undefined && !d.type.startsWith('__'))
        .map((d) => d.type),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function checkLibraryMember(libName: string, member: string, node: any): void {
    const allowed = SANDBOX_GLOBALS.libraryMembers.get(libName);
    if (allowed && allowed.has(member)) return;
    issues.push({
      category: 'sandbox-violation',
      message: `'${libName}.${member}' is not allowed`,
      ...locOf(node.identifier ?? node),
      identifier: `${libName}.${member}`,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function checkIdentifier(node: any): void {
    const name = node.name as string;
    if (scope.isLocal(name)) return; // tainted locals included — Phase 1 already reported
    if (SANDBOX_GLOBALS.topLevel.has(name)) return;
    issues.push({
      category: 'sandbox-violation',
      message: `'${name}' is not in the sandbox`,
      ...locOf(node),
      identifier: name,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function argsOf(node: any): any[] {
    if (node.type === 'CallExpression') return node.arguments ?? [];
    if (node.type === 'TableCallExpression') return [node.arguments];
    if (node.type === 'StringCallExpression') return [node.argument];
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isGeoTypeCall(node: any): boolean {
    const base = node.base;
    return (
      base?.type === 'MemberExpression' &&
      base.indexer === '.' &&
      base.base?.type === 'Identifier' &&
      base.base.name === 'geo' &&
      !scope.isLocal('geo') &&
      base.identifier?.name !== 'node'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function checkGeoCallShape(node: any, args: any[]): void {
    const typeName = node.base.identifier.name as string;
    const doc = getKernelTypeDoc(typeName);
    if (!doc) return; // already reported as unknown-geo-type
    const required = doc.paramSchema.filter((p) => p.required).map((p) => p.name);
    const all = doc.paramSchema.map((p) => p.name);

    const paramsArg = args[0];
    if (paramsArg === undefined) {
      if (required.length > 0) {
        issues.push({
          category: 'missing-geo-param',
          message: `geo.${typeName} missing required param${required.length === 1 ? '' : 's'}: ${required.join(', ')}`,
          ...locOf(node),
          validNames: required,
        });
      }
      return;
    }
    if (paramsArg.type !== 'TableConstructorExpression') {
      issues.push({
        category: 'unanalyzable-access',
        message: `geo.${typeName}(...) first argument must be a table literal so its keys can be checked statically`,
        ...locOf(paramsArg),
      });
      return;
    }
    const presentKeys = new Set<string>();
    for (const field of paramsArg.fields ?? []) {
      if (field.type === 'TableKeyString') {
        const key = field.key?.name as string | undefined;
        if (key === undefined) continue;
        presentKeys.add(key);
        if (!all.includes(key)) {
          issues.push({
            category: 'unknown-geo-param',
            message: `geo.${typeName} has no param '${key}'`,
            ...locOf(field.key ?? field),
            identifier: key,
            validNames: all,
          });
        }
      }
      // TableKey ([expr] = ...) and TableValue (positional) are not statically
      // resolvable to param names; treat presence as nothing.
    }
    const missing = required.filter((r) => !presentKeys.has(r));
    if (missing.length > 0) {
      issues.push({
        category: 'missing-geo-param',
        message: `geo.${typeName} missing required param${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
        ...locOf(paramsArg),
        validNames: missing,
      });
    }
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
