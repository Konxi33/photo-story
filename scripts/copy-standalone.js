// scripts/copy-standalone.js
// next build 之后执行：把 .next/static 与 public 拷进 standalone。

import { access, cp, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(standaloneDir))) {
    console.error(
      '找不到 .next/standalone。请确认 next.config.ts 里有 output: "standalone"，并先执行 npm run build。',
    );
    process.exit(1);
  }

  const staticSrc = path.join(root, '.next', 'static');
  const staticDest = path.join(standaloneDir, '.next', 'static');
  await rm(staticDest, { recursive: true, force: true });
  await cp(staticSrc, staticDest, { recursive: true });
  console.log('已拷贝 .next/static');

  const publicSrc = path.join(root, 'public');
  if (await exists(publicSrc)) {
    const publicDest = path.join(standaloneDir, 'public');
    await rm(publicDest, { recursive: true, force: true });
    await cp(publicSrc, publicDest, { recursive: true });
    console.log('已拷贝 public');
  } else {
    console.log('没有 public 目录，跳过');
  }

  console.log('standalone 资源拷贝完成');
}

main().catch((error) => {
  console.error('拷贝失败：', error);
  process.exit(1);
});
