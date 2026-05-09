import tsEslint from 'typescript-eslint';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default [
  ...tsEslint.config(...tsEslint.configs.recommended),
  ...sveltePlugin.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsEslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    rules: {
      // _-prefixed args/vars are intentionally unused (e.g. {#each arr as _, i}).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Icons are imported via `?raw` at build time — no user-controlled HTML
      // ever flows through {@html}. The Web Worker is the security boundary
      // for user code (see CLAUDE.md and AUDIT.md A7).
      'svelte/no-at-html-tags': 'off',
    },
  },
  {
    ignores: ['dist', 'node_modules', '.svelte-kit', 'coverage'],
  },
];
