// scripts/build-release.cjs
// 打包 + 归档。app.asar 偶尔会被残留句柄锁住导致 electron-builder 失败，
// 这里自动回退到 dist-build 输出目录，保证流程不中断。

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

function run(command, args, label) {
  console.log(`\n[release] ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  return result.status === 0;
}

function installerExists(dir) {
  return fs.existsSync(path.join(ROOT, dir, `照片故事-${version}-安装版.exe`));
}

let source = 'dist-electron';

if (!run('npx', ['electron-builder', '--win'], 'electron-builder（默认输出 dist-electron）')) {
  console.warn('[release] 默认目录打包失败，通常在 app.asar 被占用；回退到 dist-build');
  source = 'dist-build';
  fs.rmSync(path.join(ROOT, source), { recursive: true, force: true });

  if (!run(
    'npx',
    ['electron-builder', '--win', '--config.directories.output=dist-build'],
    'electron-builder（回退输出 dist-build）',
  )) {
    console.error('[release] 两种输出目录都失败，请检查是否有进程占用 dist-electron');
    process.exit(1);
  }
}

if (!installerExists(source)) {
  console.error(`[release] ${source} 里没有找到 v${version} 的安装包`);
  process.exit(1);
}

if (!run('node', ['scripts/collect-release.cjs', source], '归档到 安装包/')) {
  process.exit(1);
}

console.log(`\n[release] 完成：安装包/${version}/`);
