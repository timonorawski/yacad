/**
 * Compiles a Lua deformation expression into a synchronous per-vertex callback
 * the kernel can hand to Manifold.warp(). The Lua engine is hidden behind the
 * interface so @yacad/kernel-manifold does not depend on a specific Lua runtime
 * — @yacad/lua provides the Wasmoon-backed implementation, and the worker
 * host wires them together.
 *
 * The returned callback is synchronous because Manifold's warp() requires a
 * synchronous JS function (it is invoked once per vertex while the WASM holds
 * the mesh).
 */
export interface WarpCallback {
  (x: number, y: number, z: number): readonly [number, number, number];
}

export interface WarpEvaluator {
  /**
   * Compile a Lua function body that returns the new vertex position. `values`
   * is exposed inside the sandbox as `params` (matching the LuaNode convention)
   * so the deformation can be parametric without literal-inlining values into
   * the code string.
   *
   * The returned callback is reusable across every vertex of one warp
   * evaluation. Engine lifetime is tied to the callback — the kernel discards
   * the callback after the warp call and the engine is collected.
   */
  compile(code: string, values: Record<string, unknown>): Promise<WarpCallback>;
}
