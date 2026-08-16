import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      'node_modules/**',
      // Covers .next and the .next-check output of `npm run build:check`.
      '.next*/**',
      'coverage/**',
      'legacy/**',
      'src/db/migrations/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Rule 11 of the project charter: no `any`, anywhere.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Scripts run outside Next.js (seed, migrate) legitimately log to stdout.
    // `.mjs` included: an operator script is no less a script for being plain
    // JavaScript, and a warning nobody can act on trains people to ignore the
    // list it appears in.
    files: ['src/db/**/*.ts', 'scripts/**/*.{ts,mjs}'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
