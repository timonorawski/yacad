/**
 * Per-parameter documentation used by the studio's property inspector and by
 * any other introspection tool (Lua API docs, future code completion).
 */
export interface ParamDoc {
  readonly name: string;
  readonly type: 'number' | 'int' | 'boolean' | 'string' | 'vec2' | 'vec3';
  readonly required: boolean;
  readonly default?: unknown;
  readonly doc: string;
  readonly min?: number;
  readonly max?: number;
  readonly enum?: readonly string[];
}

/** Kernel-node-type summary fields, surfaced via getKernelTypeDoc. */
export interface KernelTypeDocSummary {
  readonly summary: string;
  readonly outputDoc: string;
  readonly paramSchema: readonly ParamDoc[];
}
