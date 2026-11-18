import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'data/**',
      'dist-electron/**',
      // 0.6.0：app.asar 被占用时构建会回退到 dist-build，产物里全是压缩后的
      // 服务端代码，被 lint 扫到会产生上千条假错误。
      'dist-build/**',
      'coverage/**',
      'next-env.d.ts',
      'install-part-*.cjs',
      '.devtools/**',
      '.shots/**',
      '安装包/**',
      'public/vendor/**',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    files: [
      'src/components/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/lib/store/**/*.{ts,tsx}',
      'src/lib/export/**/*.{ts,tsx}',
      'src/app/**/page.tsx',
      'src/app/**/layout.tsx',
      'src/app/**/error.tsx',
      'src/app/**/not-found.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/ai/server/*', 'openai'],
              message:
                '该模块仅限服务端使用（包含 API Key 读写）。请改为调用 /api/* 路由。',
            },
            {
              group: ['node:*', 'fs', 'path', 'crypto'],
              message: '浏览器端不可引用 Node 内置模块，请改用 Web API。',
            },
          ],
        },
      ],
    },
  },

  // 主进程 / 构建脚本是 Node CommonJS 环境，require 是正当写法
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.{cjs,js}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  {
    files: ['src/app/api/**/*.ts', 'src/lib/ai/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/lib/db/*',
                '@/lib/export/*',
                '@/lib/store/*',
                '@/lib/image/*',
                'docx',
                'idb',
                'zustand',
              ],
              message: '该模块依赖浏览器 API，不可在服务端路由中引用。',
            },
          ],
        },
      ],
    },
  },
];

export default config;
