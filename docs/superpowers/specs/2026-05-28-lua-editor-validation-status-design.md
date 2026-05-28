# Lua editor validation-status indicator design

**Status**: design approved 2026-05-28. Implementation pending.
**Date**: 2026-05-28
**Scope**: A live validation-state indicator in the studio2 Lua code editor (Monaco slide-over) that shows whether `validateLuaSource` passed — even on success — plus the last-run validation duration. Builds on the [Lua static validation](2026-05-28-lua-static-validation-design.md) work.

## Context

The [Lua static validation](2026-05-28-lua-static-validation-design.md) feature added `validateLuaSource(def)` and wired it into three boundaries (worker put, studio session pre-put, `LuaInspector` panel). The `LuaInspector` shows a red issues list **only when validation fails** — when the source is clean, there is no visible signal that validation ran at all.

Separately, users now edit Lua source in the Monaco slide-over editor (`apps/studio2/src/ui/LuaEditor.svelte`), which has no validation feedback of its own; problems only surface on save (via the session pre-put guard) or in the inspector after the node is re-selected.

This spec adds a small always-visible status indicator to the **Lua editor header** that:

1. Confirms validation ran successfully (`✓ validated`), not just silence-on-success.
2. Shows the issue count when it fails (`N issues`).
3. Displays the last-run wall-clock duration (`1.2ms`) so we can watch validator performance as scripts grow — the explicit motivation for this work.

## Goals

- Always-visible validation state in the Lua editor — passing **and** failing — so the user knows the validator is live.
- Per-run timing readout for performance observation.
- Live updates as the user types, debounced to match the existing studio responsiveness model.
- Minimal, self-contained change: no new packages, no cross-component plumbing.

## Non-goals

- **Inline Monaco markers (red squiggles).** The `ValidationIssue.line`/`column` fields exist for this, but v1 ships the header summary only. Squiggles are a forward-looking follow-up.
- **The full issue list in the editor.** The `LuaInspector` already renders the issue list when a Lua node is selected. The editor header shows only the count; users consult the inspector for detail.
- **Rolling-average / max-seen timing.** v1 shows last-run duration only. A timing history (ring buffer, max-seen) is deferred.
- **Schema editor for LuaDefinitions.** Defining a LuaDefinition's `schema` (inputs/params/output) from scratch in the UI is a separate, larger piece — it is the "Schema editor vs. JSON for LuaDefinitions" open question carried from the LuaNode spec. This spec validates the live **code** against the node's **existing** schema; it does not let the user edit the schema. The schema editor is the natural next piece of work after this lands.
- **Validation timing surfaced in `PerformancePanel`.** Considered and deferred — the editor is the chosen single surface. If aggregate cross-node validation timing is wanted later, that's a separate change (and the right moment to extract a shared `validateTimed` helper).

## Decisions and rationale

### Indicator lives in the Lua editor header

The editor is where users actively work on Lua source, so it's where live feedback is most expected. _Rejected:_ the `LuaInspector` (only relevant when a node is selected, not when actively editing), the `PerformancePanel` (loses per-edit context; aggregate timing is a different use case), and the viewport footer (too far from the editing context, and can't show the issue count meaningfully).

### Always-visible passing state, not silence-on-success

The whole point is "know it's running even when it passes." A `✓ validated` chip is shown on success, distinct from the failing `N issues` state. _Rejected:_ showing nothing on success (the current `LuaInspector` behavior — which is exactly the gap this closes).

### Last-run duration inline with the status

`✓ validated (1.2ms)` / `2 issues (1.4ms)`. Simplest useful timing signal; surfaces when a specific edit spikes parse time. _Rejected:_ rolling average and max-seen — more state, more noise, deferred until a real need surfaces.

### Debounced live validation (~150ms after typing stops)

Re-validate the live editor buffer shortly after the user pauses, mirroring the 150ms eval-debounce already used in `ViewportPane`. _Rejected:_ per-keystroke (re-parses on every keypress; timing readout flickers) and on-save-only (indicator goes stale while editing — defeats the goal).

### Self-contained in `LuaEditor.svelte`, no extracted helper

The timing + debounce + state is ~15 lines and has exactly one consumer. _Rejected:_ extracting a `validateTimed(def)` into `@yacad/lua` (`performance.now()` is a host concern, odd in a pure-logic package; YAGNI for one consumer) and a studio2 `validation-status.svelte.ts` helper module (premature abstraction for a single placement). If validation timing later needs sharing, extraction is the clean refactor at that point.

### Validate `codeBuffer` against the fixed `definition.schema`

The user edits **code** in the Monaco slide-over; the **schema** is not editable here. So validation pairs the live code with the unchanged schema — exactly what `addLuaDefinition` validates on save. This keeps the editor's live check consistent with the save-time gate.

## Architecture

Single file changed: `apps/studio2/src/ui/LuaEditor.svelte`. No package changes, no new files.

### State

```ts
import { validateLuaSource, LuaValidationError } from '@yacad/lua';

interface ValidationStatus {
  ok: boolean;
  count: number; // issue count; 0 when ok
  ms: number;    // last-run wall-clock duration
}

let validation = $state<ValidationStatus>({ ok: true, count: 0, ms: 0 });
let validateTimer: ReturnType<typeof setTimeout> | undefined;
const VALIDATE_DEBOUNCE_MS = 150;
```

### Validation runner

```ts
function runValidation() {
  const t0 = performance.now();
  let count = 0;
  let ok = true;
  try {
    validateLuaSource({ schema: definition.schema, code: codeBuffer });
  } catch (e) {
    if (e instanceof LuaValidationError) {
      ok = false;
      count = e.issues.length;
    } else {
      throw e; // non-validation errors propagate (matches LuaInspector's pattern)
    }
  }
  validation = { ok, count, ms: performance.now() - t0 };
}
```

### Wiring

- **On content change**: the existing `editor.onDidChangeModelContent` handler already sets `codeBuffer` and `dirty`. Add a debounced re-validate:
  ```ts
  clearTimeout(validateTimer);
  validateTimer = setTimeout(runValidation, VALIDATE_DEBOUNCE_MS);
  ```
- **On mount**: call `runValidation()` once eagerly after `editor` is created, so the initial chip reflects the loaded definition rather than the default `{ ok: true, count: 0, ms: 0 }`.
- **On destroy**: `clearTimeout(validateTimer)` alongside the existing `editor?.dispose()`.

### Header rendering

A status chip in the existing `.lua-editor-actions` cluster, placed before the "API reference" button (reads state → actions, left to right):

```svelte
<span
  class="lua-validation-status"
  class:ok={validation.ok}
  class:invalid={!validation.ok}
  title={validation.ok
    ? `Lua validated in ${validation.ms.toFixed(1)}ms`
    : `${validation.count} validation issue${validation.count === 1 ? '' : 's'} (${validation.ms.toFixed(1)}ms)`}
>
  {#if validation.ok}
    ✓ validated
  {:else}
    {validation.count} issue{validation.count === 1 ? '' : 's'}
  {/if}
  <span class="lua-validation-ms">{validation.ms.toFixed(1)}ms</span>
</span>
```

The compact chip reads `✓ validated 1.2ms` / `2 issues 1.4ms`; the `title` gives the full sentence on hover.

### Styling

The studio2 palette (`apps/studio2/src/app.css`) has no success/green variable. Available: `--accent` (`#7aa2f7`, blue), `--error` (`#f7768e`, pink), `--fg` (`#e5e5e5`), `--panel`, `--panel-border`. The chip uses:

- `.lua-validation-status.ok` → text `var(--accent)`.
- `.lua-validation-status.invalid` → text `var(--error)`.
- `.lua-validation-ms` → `opacity: 0.6` so the timing reads as secondary.
- Layout: `inline-flex; gap: 0.4em; align-items: center; font-size: 0.85em;` consistent with the existing header action text.

The `✓` glyph carries the success signal so the indicator is not color-only (accessibility).

## Data flow

1. User types in Monaco → `onDidChangeModelContent` fires → `codeBuffer` updated, `dirty` recomputed (existing behavior).
2. The same handler (re)arms `validateTimer` for `VALIDATE_DEBOUNCE_MS`.
3. After the user pauses, `runValidation()` runs: times `validateLuaSource({ schema: definition.schema, code: codeBuffer })`, catches `LuaValidationError` for the count, stores `{ ok, count, ms }`.
4. The header chip re-renders reactively from `validation`.
5. Save / revert / close are unchanged; the chip simply reflects whatever the buffer last validated to.

## Error handling

- `LuaValidationError` is the expected failure — caught, converted to `{ ok: false, count }`.
- Any other throw from `validateLuaSource` (it shouldn't, but defensively) propagates — same discipline as the `LuaInspector` derived. This avoids silently masking a validator bug as "valid."
- The debounce timer is cleared on destroy to avoid a `runValidation` firing against a disposed editor.

## Testing strategy

- **Validator logic** is already exhaustively covered by `packages/lua/src/static-analyze.test.ts`; this spec adds no new validator-logic tests.
- **Component-level Vitest**: a focused unit test for the chip is low-value because Monaco needs a real DOM container and editor instance, and the validation logic is already tested. Skip a dedicated component test; rely on the Playwright path below for the wire-up.
- **Playwright e2e** (extends the existing studio2 Lua flow): open the Lua editor on the seeded gear scene; assert the `.lua-validation-status.ok` chip is visible and shows a `Nms` reading; type an invalid edit (e.g., replace the body with `return geo.bogus({})`); after the debounce, assert the chip flips to `.lua-validation-status.invalid` with an issue count. This exercises the full content-change → debounce → validate → render path in a real browser.

## Forward-looking notes

- **Inline Monaco markers.** Push `ValidationIssue[]` into `monaco.editor.setModelMarkers` so each issue gets a squiggle at its `line:column` with the message on hover. The `line`/`column` fields already exist for this.
- **Shared `validateTimed` helper.** If validation timing is later wanted in `PerformancePanel` or elsewhere, extract a timed wrapper (in studio2, or in `@yacad/lua` if the host-timing concern is acceptable) — the clean refactor once a second consumer exists.
- **Timing history.** Rolling average / max-seen over an editing session, if last-run proves too noisy to spot trends.
- **Schema editor for LuaDefinitions.** The next piece of work: a UI to define/edit a LuaDefinition's `schema` (inputs, params, output) so new Lua functions can be authored in-studio rather than seeded. This indicator validates code against an existing schema; authoring the schema itself is out of scope here and is the LuaNode spec's deferred "Schema editor vs. JSON" open question.
