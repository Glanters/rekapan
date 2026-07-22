import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
      // Prisma emits its client here; it is generated, not authored.
      'src/generated/**',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    rules: {
      // Server logs belong in a real logger. `warn` and `error` stay allowed so
      // genuine failure paths are not forced through a lint disable.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
    },
  },

  {
    // `@typescript-eslint` is supplied by the `next/typescript` preset above,
    // which scopes it to TypeScript files — so this rule is scoped to match.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // The base rule misreports type-only and overload signatures.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // `_`-prefixed names are the conventional "deliberately unused" marker,
          // needed when a signature must keep a positional parameter.
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];

export default eslintConfig;
