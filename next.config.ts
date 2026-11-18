import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // 0.6.0：老电脑启动慢主要是首包大——把图标库与 Radix 按需引入，
  // 只打进真正用到的模块，首屏 JS 明显变小。
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },

  output: 'standalone',

  images: {
    unoptimized: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typedRoutes: false,

  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      fs: false,
      path: false,
      os: false,
      https: false,
      http: false,
      crypto: false,
      stream: false,
      buffer: false,
      url: false,
      zlib: false,
    };

    // pptxgenjs 主入口引用了 node:fs / node:https（Node 分支）。
    // 浏览器构建直接指向它自带的 UMD 浏览器包，避免 node: 协议报错。
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      pptxgenjs$: path.join(
        process.cwd(),
        'node_modules',
        'pptxgenjs',
        'dist',
        'pptxgen.bundle.js',
      ),
    };

    return config;
  },
};

export default nextConfig;
