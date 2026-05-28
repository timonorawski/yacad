<script lang="ts">
  import { marked } from 'marked';
  import { listNodeTypes } from '@yacad/dag';
  import { KERNEL_TYPE_DOCS } from '@yacad/lua';
  import languageReferenceMd from '../../../../docs/language-reference.md?raw';
  import architectureMd from '../../../../docs/architecture.md?raw';
  import featuresMd from '../../../../docs/features.md?raw';

  export type DocsTab = 'language' | 'luaApi' | 'architecture' | 'features';

  interface Props {
    open: boolean;
    tab: DocsTab;
    onTabChange: (tab: DocsTab) => void;
    onClose: () => void;
  }

  let { open, tab, onTabChange, onClose }: Props = $props();

  // Filter KERNEL_TYPE_DOCS down to currently-registered kernel types.
  const registeredKernelTypes = new Set(
    listNodeTypes()
      .filter((t) => !t.type.startsWith('__'))
      .map((t) => t.type),
  );

  function buildLuaApiMd(): string {
    const lines: string[] = [];

    lines.push(`## Lua environment`);
    lines.push('');
    lines.push('- `params.<name>` — values declared in the LuaDefinition schema');
    lines.push('- `inputs.<name>` — child input refs (sentinel resolved by engine)');
    lines.push('- `inputs.<name>.outputType()` — synchronous geometry-type query');
    lines.push('- `geo.*` — kernel-backed node constructors (see below)');
    lines.push('- `math`, `string`, `table` — pure stdlib subsets');
    lines.push('- `os`, `io`, `package`, `require`, `print`, `load` — **NOT exposed**');
    lines.push(
      '- `math.random` — seeded deterministically from `definitionHash + canonical(values)`',
    );
    lines.push('');

    lines.push('## Return value');
    lines.push('');
    lines.push(
      'A NodeDoc table — `geo.*` calls compose into one. The trailing return value of the script is the emitted sub-DAG.',
    );
    lines.push('');

    lines.push('## `geo.*` API');
    lines.push('');

    for (const doc of KERNEL_TYPE_DOCS) {
      if (!registeredKernelTypes.has(doc.type)) continue;

      const childrenArg = doc.paramSchema.length === 0 ? 'children?' : 'params, children?';
      lines.push(`### \`geo.${doc.type}(${childrenArg}) → ${doc.outputDoc}\``);
      lines.push('');
      lines.push(doc.summary);
      lines.push('');

      if (doc.paramSchema.length > 0) {
        lines.push('**Parameters:**');
        lines.push('');
        for (const p of doc.paramSchema) {
          const req = p.required ? '' : ` *(default: \`${JSON.stringify(p.default)}\`)*`;
          lines.push(`- \`${p.name}\` (\`${p.type}\`)${req}: ${p.doc}`);
        }
        lines.push('');
      }

      lines.push('**Example:**');
      lines.push('');
      lines.push('```lua');
      lines.push(doc.example);
      lines.push('```');
      lines.push('');
    }

    lines.push('## `geo.node(type, params?, children?)`');
    lines.push('');
    lines.push(
      'Primitive constructor — drop down to this for types not yet wrapped, or for dynamic dispatch. Rejects reserved `__`-prefixed types and expandable types like `lua` itself.',
    );
    lines.push('');

    return lines.join('\n');
  }

  const languageReferenceHtml = marked.parse(languageReferenceMd) as string;
  const luaApiHtml = marked.parse(buildLuaApiMd()) as string;
  const architectureHtml = marked.parse(architectureMd) as string;
  const featuresHtml = marked.parse(featuresMd) as string;
</script>

<aside class="docs-drawer" class:open>
  <header class="docs-drawer-header">
    <div class="docs-drawer-tabs">
      <button
        type="button"
        class="tab-btn"
        class:active={tab === 'language'}
        onclick={() => onTabChange('language')}
      >
        Language Reference
      </button>
      <button
        type="button"
        class="tab-btn"
        class:active={tab === 'luaApi'}
        onclick={() => onTabChange('luaApi')}
      >
        Lua API
      </button>
      <button
        type="button"
        class="tab-btn"
        class:active={tab === 'architecture'}
        onclick={() => onTabChange('architecture')}
      >
        Architecture
      </button>
      <button
        type="button"
        class="tab-btn"
        class:active={tab === 'features'}
        onclick={() => onTabChange('features')}
      >
        Features
      </button>
    </div>
    <button type="button" class="docs-drawer-close" onclick={onClose} aria-label="Close docs"
      >×</button
    >
  </header>
  <div class="docs-drawer-content">
    {#if tab === 'language'}
      {@html languageReferenceHtml}
    {:else if tab === 'luaApi'}
      {@html luaApiHtml}
    {:else if tab === 'architecture'}
      {@html architectureHtml}
    {:else}
      {@html featuresHtml}
    {/if}
  </div>
</aside>
