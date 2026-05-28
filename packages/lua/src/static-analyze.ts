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
export function validateLuaSource(_def: LuaDefinition): void {
  // Stub — real implementation lands in Task 7+.
}
