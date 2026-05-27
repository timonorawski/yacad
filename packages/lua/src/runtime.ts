import type { NodeDoc } from '@yacad/dag';
import type { LuaDefinition } from './schema';

export type LuaErrorPhase = 'compile' | 'runtime' | 'output';

export interface LuaErrorOptions {
  phase: LuaErrorPhase;
  line?: number;
  column?: number;
  cause?: Error;
}

export class LuaError extends Error {
  override readonly name = 'LuaError';
  readonly phase: LuaErrorPhase;
  readonly line?: number;
  readonly column?: number;
  override readonly cause?: Error;

  constructor(message: string, opts: LuaErrorOptions) {
    super(message);
    this.phase = opts.phase;
    if (opts.line !== undefined) this.line = opts.line;
    if (opts.column !== undefined) this.column = opts.column;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/** Read-only view of an expandable node's child input, passed to Lua via the
 *  `inputs` table. `outputType()` is sync — populated from the already-built
 *  child Node (see spec §`@yacad/lua` public surface). */
export interface InputRef {
  readonly name: string;
  readonly type: '2d' | '3d';
  outputType(): '2d' | '3d';
}

export interface LuaRuntime {
  evaluate(
    def: LuaDefinition,
    inputs: readonly InputRef[],
    values: Record<string, unknown>,
  ): Promise<NodeDoc>;
  dispose(): void;
}
