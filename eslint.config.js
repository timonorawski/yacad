import yacad from '@yacad/eslint-config';

export default [
  ...yacad,
  {
    // Svelte app linting is handled by svelte-check; keep ESLint to TS sources.
    ignores: ['apps/**/dist/**', '**/*.svelte'],
  },
];
