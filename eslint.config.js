import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'dist-e2e/', 'release/', 'test-results/', 'node_modules/', 'spikes/', 'coverage/', '.remember/', '.profile*/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Use textContent / DOM APIs (spec §6: no HTML injection).' },
        { property: 'outerHTML', message: 'Use DOM APIs.' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  { files: ['**/*.d.ts'], rules: { 'no-var': 'off', '@typescript-eslint/no-empty-object-type': 'off' } },
  { files: ['scripts/**', 'tests/e2e/**'], rules: { 'no-console': 'off', 'no-undef': 'off', 'no-restricted-properties': 'off' } }, // node + page.evaluate code; reads innerHTML only to compare
);
