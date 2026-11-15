import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';
export default ts.config(
  {
    ignores: [
      'spikes/**',
      'research/redesign/mockups/**',
      'corpus/**',
      'node_modules/**',
      'dist/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['src/{studio,views,lib}/**/*.{ts,tsx}'],
    extends: [...ts.configs.strictTypeChecked, ...ts.configs.stylisticTypeChecked],
    languageOptions: { parserOptions: { projectService: true } },
    plugins: { 'react-hooks': hooks },
    rules: hooks.configs.recommended.rules,
  },
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
