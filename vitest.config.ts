import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 0.8.0：给 vitest 补上 tsconfig 里的 `@/*` 别名（之前 `npm test` 一个测试文件都没有，
// 这条路径从没被验证过，加了第一个测试才暴露出来）
export default defineConfig({
  // 与 Next 一致：JSX 走自动运行时（否则组件里要手写 import React）
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // jsdom 默认跑在 about:blank（不透明源）上，localStorage 直接是 undefined；
    // 给个真实地址，设置持久化才测得了
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
  },
});
