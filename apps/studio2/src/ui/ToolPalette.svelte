<script lang="ts">
  import { getAt, addChild, removeAt, wrapWith } from '@yacad/mutations';
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

  interface WrapCandidate {
    readonly type: string;
    readonly summary: string;
    readonly params: Record<string, unknown>;
  }

  /** Iterate registered kernel types; keep those that accept the selected node
   *  as their sole child. The check synthesizes a Node-shaped object with the
   *  selected node's outputType, then runs the kernel's checkChildren. */
  const candidates = $derived.by<readonly WrapCandidate[]>(() => {
    if (!selectedNode || !selectedOutputType) return [];

    const synthetic: Node = {
      id: '$/0',
      type: selectedNode.type,
      params: (selectedNode.params ?? {}) as Record<string, unknown>,
      children: [],
      outputType: selectedOutputType,
      hash: '',
    };

    const out: WrapCandidate[] = [];
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

  async function addPrimitiveChild() {
    if (!selection.selectedId) return;
    const seed = { type: 'box', params: { size: [10, 10, 10], center: true } };
    try {
      await session.session.mutate((prev) => addChild(prev, selection.selectedId!, seed));
    } catch (err) {
      console.error(err);
    }
  }
</script>

<div class="tool-palette">
  <details>
    <summary>Wrap with…</summary>
    {#if candidates.length === 0}
      <div class="wrap-empty">no wrappers accept this node</div>
    {:else}
      {#each candidates as w (w.type)}
        <button type="button" title={w.summary} onclick={() => void wrapWithType(w.type, w.params)}
          >{w.type}</button
        >
      {/each}
    {/if}
  </details>
  <button onclick={addPrimitiveChild} disabled={!selectedNode}>+ child (box)</button>
  <button onclick={deleteSelected} disabled={!selection.selectedId || selection.selectedId === '$'}>
    delete
  </button>
</div>
