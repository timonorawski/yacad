import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint config for the yacad workspace.
 * Type-aware linting is intentionally left off for the POC to keep lint fast;
 * tsc -b is the type-correctness gate.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/*.tsbuildinfo'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
