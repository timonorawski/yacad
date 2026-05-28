<script lang="ts">
  import { getAt, addChild, removeAt, unwrap, wrapWith } from '@yacad/mutations';
  import {
    getKernelTypeDoc,
    getNodeType,
    listNodeTypes,
    type GeometryType,
    type Node,
    type ParamDoc,
  } from '@yacad/dag';
  import type { SessionState } from '../state/session.svelte';
  import type { SelectionState } from '../state/selection.svelte';

  interface Props {
    session: SessionState;
    selection: SelectionState;
  }

  let { session, selection }: Props = $props();

  const selectedNode = $derived.by(() => {
    if (!selection.selectedId) return undefined;
    try {
      return getAt(session.doc, selection.selectedId);
    } catch {
      return undefined;
    }
  });

  /** Best-effort static output type of the selected node. */
  function staticOutputType(typeName: string): GeometryType | undefined {
    const def = getNodeType(typeName);
    if (!def) return undefined;
    if (def.kind === 'kernel') {
      if (typeof def.output === 'function') {
        // Overloaded ops (union/difference/hull) — best-effort skipped here.
        return undefined;
      }
      return def.output;
    }
    if (def.kind === 'expandable') {
      // Lua and friends — main-thread stub returns the schema's declared output
      // when the resolver has the definition. Try via the session's blobs.
      const blobs = session.session.blobs;
      try {
        return def.resolveOutput((selectedNode?.params ?? {}) as Record<string, unknown>, {
          get: (h) => blobs.get(h),
        });
      } catch {
        return undefined;
      }
    }
    if (def.kind === 'decoder') {
      return def.output;
    }
    return undefined;
  }

  const selectedOutputType = $derived.by<GeometryType | undefined>(() => {
    if (!selectedNode) return undefined;
    return staticOutputType(selectedNode.type);
  });

  /** Synthesize a default value for a paramSchema entry. */
  function defaultParamValue(schema: ParamDoc): unknown {
    if (schema.default !== undefined) return schema.default;
    if (!schema.required) return undefined;
    if (schema.enum && schema.enum.length > 0) return schema.enum[0];
    switch (schema.type) {
      case 'number':
      case 'int':
        return 0;
      case 'boolean':
        return false;
      case 'string':
        return '';
      case 'vec2':
        return [0, 0];
      case 'vec3':
        return [0, 0, 0];
      case 'vec2-array':
        return [
          [0, 0],
          [1, 0],
          [0, 1],
        ];
    }
    return undefined;
  }

  /** Build a default params object from the kernel type's schema. */
  function defaultParams(paramSchema: readonly ParamDoc[]): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const p of paramSchema) {
      const v = defaultParamValue(p);
      if (v !== undefined) params[p.name] = v;
    }
    return params;
  }

  interface TypeCandidate {
    readonly type: string;
    readonly summary: string;
    readonly params: Record<string, unknown>;
  }

  /** Iterate registered kernel types; keep those that accept the selected node
   *  as their sole child. The check synthesizes a Node-shaped object with the
   *  selected node's outputType, then runs the kernel's checkChildren. */
  const wrapCandidates = $derived.by<readonly TypeCandidate[]>(() => {
    if (!selectedNode || !selectedOutputType) return [];

    const synthetic: Node = {
      id: '$/0',
      type: selectedNode.type,
      params: (selectedNode.params ?? {}) as Record<string, unknown>,
      children: [],
      outputType: selectedOutputType,
      hash: '',
    };

    const out: TypeCandidate[] = [];
    for (const entry of listNodeTypes()) {
      const def = getNodeType(entry.type);
      if (!def || def.kind !== 'kernel') continue;
      try {
        def.checkChildren([synthetic], '$');
      } catch {
        continue;
      }
      const doc = getKernelTypeDoc(entry.type);
      out.push({
        type: entry.type,
        summary: doc?.summary ?? '',
        params: defaultParams(doc?.paramSchema ?? []),
      });
    }
    out.sort((a, b) => a.type.localeCompare(b.type));
    return out;
  });

  /** Iterate registered kernel types; keep those that:
   *   1. Are themselves leaf-able (their checkChildren accepts an empty array,
   *      so the new child node is structurally valid on its own).
   *   2. The selected parent's checkChildren accepts when appended to the
   *      parent's existing children list.
   *  Yields the "+ child" picker's content. Returns [] when the selection has
   *  no checkChildren constraint we can probe (non-kernel parents). */
  const childCandidates = $derived.by<readonly TypeCandidate[]>(() => {
    if (!selectedNode) return [];
    const parentDef = getNodeType(selectedNode.type);
    if (!parentDef || parentDef.kind !== 'kernel') return [];

    // Materialize existing children as synthetic Nodes so the parent's
    // checkChildren can be invoked on the augmented list.
    const existingChildren: Node[] = (selectedNode.children ?? []).map((c, i) => {
      const outputType = staticOutputType(c.type) ?? '3d';
      return {
        id: `${selection.selectedId}/${i}`,
        type: c.type,
        params: (c.params ?? {}) as Record<string, unknown>,
        children: [],
        outputType,
        hash: '',
      };
    });

    const out: TypeCandidate[] = [];
    for (const entry of listNodeTypes()) {
      const def = getNodeType(entry.type);
      if (!def || def.kind !== 'kernel') continue;
      // 1) The candidate child type must accept zero children (leaf-able);
      //    a fresh node has [].
      try {
        def.checkChildren([], '$/_probe');
      } catch {
        continue;
      }
      // 2) The candidate's static output type — primitives have a fixed
      //    output; overloaded types (function output) we can't probe with []
      //    so they're already filtered above.
      const candidateOutput = typeof def.output === 'function' ? undefined : def.output;
      if (!candidateOutput) continue;
      // 3) Parent must accept the candidate appended.
      const synthetic: Node = {
        id: `${selection.selectedId}/_new`,
        type: entry.type,
        params: {},
        children: [],
        outputType: candidateOutput,
        hash: '',
      };
      try {
        parentDef.checkChildren([...existingChildren, synthetic], selection.selectedId ?? '$');
      } catch {
        continue;
      }
      const doc = getKernelTypeDoc(entry.type);
      out.push({
        type: entry.type,
        summary: doc?.summary ?? '',
        params: defaultParams(doc?.paramSchema ?? []),
      });
    }
    out.sort((a, b) => a.type.localeCompare(b.type));
    return out;
  });

  async function wrapWithType(type: string, params: Record<string, unknown>) {
    if (!selection.selectedId) return;
    try {
      await session.session.mutate((prev) => wrapWith(prev, selection.selectedId!, type, params));
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteSelected() {
    if (!selection.selectedId || selection.selectedId === '$') return;
    try {
      await session.session.mutate((prev) => removeAt(prev, selection.selectedId!));
      selection.clear();
    } catch (err) {
      console.error(err);
    }
  }

  const canUnwrap = $derived(
    selectedNode !== undefined && (selectedNode.children?.length ?? 0) === 1,
  );

  async function unwrapSelected() {
    if (!selection.selectedId || !canUnwrap) return;
    try {
      // The selected path becomes a different node after unwrap. Capture the
      // original path so we can re-select something sensible.
      const originalPath = selection.selectedId;
      await session.session.mutate((prev) => unwrap(prev, originalPath));
      // After unwrap, the path of the (former) sole child becomes the
      // unwrapped node's path. selection stays at the same path so the
      // unwrapped child is now selected.
    } catch (err) {
      console.error(err);
    }
  }

  async function addChildOfType(type: string, params: Record<string, unknown>) {
    if (!selection.selectedId) return;
    try {
      await session.session.mutate((prev) =>
        addChild(prev, selection.selectedId!, { type, params }),
      );
    } catch (err) {
      console.error(err);
    }
  }
</script>

<div class="tool-palette">
  <details>
    <summary>Wrap with…</summary>
    {#if wrapCandidates.length === 0}
      <div class="wrap-empty">no wrappers accept this node</div>
    {:else}
      {#each wrapCandidates as w (w.type)}
        <button type="button" title={w.summary} onclick={() => void wrapWithType(w.type, w.params)}
          >{w.type}</button
        >
      {/each}
    {/if}
  </details>
  <details>
    <summary>+ child…</summary>
    {#if childCandidates.length === 0}
      <div class="wrap-empty">no children accepted here</div>
    {:else}
      {#each childCandidates as c (c.type)}
        <button
          type="button"
          title={c.summary}
          onclick={() => void addChildOfType(c.type, c.params)}>{c.type}</button
        >
      {/each}
    {/if}
  </details>
  <button
    type="button"
    onclick={() => void unwrapSelected()}
    disabled={!canUnwrap}
    title="Replace this node with its sole child">unwrap</button
  >
  <button onclick={deleteSelected} disabled={!selection.selectedId || selection.selectedId === '$'}>
    delete
  </button>
</div>
