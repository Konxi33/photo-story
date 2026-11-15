// scripts/dev-electron.js
// 开发调试用：先起 next dev，等端口通了再开 Electron。
// 不引入 concurrently / wait-on，避免多两个依赖。

import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const children = [];

function run(command, args, options) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  children.push(child);
  return child;
}

function cleanup() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('exit', cleanup);

async function waitForDevServer(timeoutMs) {
  const limit = timeoutMs || 60000;
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:3939/api/settings', {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok || res.status === 400) return true;
    } catch {
      // 继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'next',
    'dev',
    '-H',
    '127.0.0.1',
    '-p',
    '3939',
  ]);

  const ready = await waitForDevServer(60000);
  if (!ready) {
    console.error('开发服务器启动超时');
    cleanup();
    process.exit(1);
  }

  const electronBin = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
  );

  const electron = run(electronBin, ['electron/main.cjs'], {
    env: { ...process.env, PHOTO_STORY_DEV: '1' },
  });

  electron.on('exit', () => {
    cleanup();
    process.exit(0);
  });
}

void main();
