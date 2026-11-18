// scripts/clean-cache.mjs
// 清理构建、打包、更新过程中留下的缓存与中间产物，释放磁盘空间。
//
// 硬规矩（不要改）：
//   1. 只删「能重新生成」的东西：构建产物、缓存、临时下载、日志；
//   2. 绝不碰 安装包/、data/、*.docx、用户照片、项目源码；
//   3. 默认 dry-run，只打印能省多少；加 --apply 才真删。
//
// 用法：
//   node scripts/clean-cache.mjs            # 只报告
//   node scripts/clean-cache.mjs --apply    # 真删
//   node scripts/clean-cache.mjs --apply --deep   # 连 node_modules/.cache、electron 下载缓存一起清

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const DEEP = process.argv.includes('--deep');
const ROOT = process.cwd();
const HOME = os.homedir();

function dirSize(target) {
  let total = 0;
  let files = 0;
  try {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) return { bytes: stat.size, files: 1 };
  } catch {
    return { bytes: 0, files: 0 };
  }
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          total += fs.statSync(full).size;
          files += 1;
        } catch {
          /* 正在被占用就跳过 */
        }
      }
    }
  }
  return { bytes: total, files };
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 目标清单：path + 说明 + 是否默认启用 */
function buildTargets() {
  const targets = [
    {
      p: path.join(ROOT, '.next'),
      why: 'Next 构建产物（重新 build 会生成）',
      enabled: true,
    },
    {
      p: path.join(ROOT, 'dist-electron'),
      why: 'electron-builder 输出目录（归档后不再需要）',
      enabled: true,
    },
    {
      p: path.join(ROOT, 'dist-build'),
      why: 'app.asar 被占用时的回退构建目录',
      enabled: true,
    },
    {
      p: path.join(ROOT, '.shots'),
      why: '调试截图（可重新生成）',
      enabled: true,
    },
    {
      p: path.join(ROOT, 'coverage'),
      why: '测试覆盖率报告',
      enabled: true,
    },
  ];

  // 更新缓存：应用内自动更新下载的安装包
  const updateDir = path.join(process.env.TEMP || process.env.TMP || os.tmpdir(), 'photo-story-update');
  targets.push({ p: updateDir, why: '自动更新下载的安装包缓存', enabled: true });

  // 旧版安装包副本（build/collect 时拷到临时目录的那些）
  const tmp = process.env.TEMP || process.env.TMP || os.tmpdir();
  targets.push({ p: path.join(tmp, 'PhotoStory-0.5.7-setup.exe'), why: '发版时拷到临时目录的安装包副本', enabled: true });
  targets.push({ p: path.join(tmp, 'photo-story-build'), why: '打包临时目录', enabled: true });

  if (DEEP) {
    targets.push({
      p: path.join(ROOT, 'node_modules', '.cache'),
      why: '依赖构建缓存（删了只是下次慢一点）',
      enabled: true,
    });
    targets.push({
      p: path.join(HOME, 'AppData', 'Local', 'electron-builder', 'Cache'),
      why: 'electron-builder 下载缓存（nsis/winCodeSign 等）',
      enabled: true,
    });
  }

  return targets;
}

function main() {
  console.log(`照片故事 · 缓存清理${APPLY ? '' : '（演练模式，加 --apply 才真删）'}`);
  console.log(`项目目录：${ROOT}`);
  console.log('');

  let total = 0;
  const rows = [];

  for (const target of buildTargets()) {
    if (!target.enabled) continue;
    if (!fs.existsSync(target.p)) continue;
    const { bytes, files } = dirSize(target.p);
    total += bytes;
    rows.push({ path: target.p, why: target.why, size: mb(bytes), files });
  }

  if (rows.length === 0) {
    console.log('没有可清理的缓存，磁盘已经是干净的。');
    return;
  }

  for (const row of rows) {
    console.log(`- ${row.path}`);
    console.log(`    ${row.size} / ${row.files} 个文件 —— ${row.why}`);
  }
  console.log('');
  console.log(`合计可释放：${mb(total)}`);

  if (!APPLY) {
    console.log('');
    console.log('要真正删除，请再运行：node scripts/clean-cache.mjs --apply');
    return;
  }

  let freed = 0;
  for (const row of rows) {
    try {
      fs.rmSync(row.path, { recursive: true, force: true });
      freed += 1;
    } catch (error) {
      console.log(`  跳过（可能被占用）：${row.path} —— ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log('');
  console.log(`已清理 ${freed} 个目录，约释放 ${mb(total)}。`);
  console.log('注意：安装包/、用户数据、导出文档都没有动。');
}

main();
