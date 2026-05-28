/**
 * Per-parameter documentation used by the studio's property inspector and by
 * any other introspection tool (Lua API docs, future code completion).
 */
export interface ParamDoc {
  readonly name: string;
  readonly type: 'number' | 'int' | 'boolean' | 'string' | 'vec2' | 'vec3' | 'vec2-array';
  readonly required: boolean;
  readonly default?: unknown;
  readonly doc: string;
  readonly min?: number;
  readonly max?: number;
  readonly enum?: readonly string[];
  /**
   * Marks this param as belonging to a mutually-exclusive group. Params
   * sharing the same `exclusiveGroup` string must have exactly one active
   * value at a time. The inspector renders a radio toggle and clears
   * inactive members on switch.
   */
  readonly exclusiveGroup?: string;
}

/** Kernel-node-type summary fields, surfaced via getKernelTypeDoc. */
export interface KernelTypeDocSummary {
  readonly summary: string;
  readonly outputDoc: string;
  readonly paramSchema: readonly ParamDoc[];
}
