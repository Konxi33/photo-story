#!/usr/bin/env node
/**
 * 密钥检查（0.7.1 起不再依赖 git —— 这个仓库本机没有 git）。
 *
 * 约定：
 *  - 源码里的 DEFAULT_AI_API_KEY 必须是空字符串 —— 安装包里不能带 Key；
 *  - 真实 Key 只存在本机运行时配置 %APPDATA%\photo-story\data\ai-config.json；
 *  - 仓库文件、构建产物（.next/standalone、dist-electron）里都不许出现真实 Key。
 *
 * 用法：
 *   node scripts/check-secrets.mjs            # 扫源码
 *   node scripts/check-secrets.mjs --built    # 再扫一遍构建产物（打包前用）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const withBuilt = process.argv.includes('--built');

// 只扫这些目录（源码 + 脚本 + 壳），不碰 node_modules
const SOURCE_DIRS = ['src', 'scripts', 'electron', 'public', 'docs'];
const SOURCE_FILES = ['package.json', 'next.config.ts', 'README.md', '项目现状.md', '设计决策与历史档案.md'];
const BUILT_DIRS = ['.next/standalone', 'dist-electron/win-unpacked/resources', 'dist-build'];

const SKIP_DIR = /(^|\/)(node_modules|\.next|dist-electron|dist-build|安装包|\.devtools|\.shots|\.git)(\/|$)/;
const BINARY_RE = /\.(png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|asar|exe|zip|7z|gz|br|docx|pptx|pdf|mp4|mov|wasm|db|bin|node)$/i;

// 真实 Key：DeepSeek/OpenAI 形制；占位符不算
const KEY_RE = /sk-[A-Za-z0-9_-]{20,}/g;
const PLACEHOLDER_RE = /sk-(your|replace|xxx+|placeholder|test|demo|example)/i;

// 本机真实 Key 的指纹：用于「构建产物里绝不能出现」这最后一道闸
function fingerprint() {
  const p = join(process.env.APPDATA ?? '', 'photo-story', 'data', 'ai-config.json');
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const key = String(raw.apiKey ?? '').trim();
    return key.length >= 20 ? key : '';
  } catch {
    return '';
  }
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIR.test(full.replaceAll('\\', '/') + '/')) continue;
      walk(full, out);
    } else if (st.size < 8 * 1024 * 1024) {
      out.push(full);
    }
  }
}

const targets = [];
if (withBuilt) {
  for (const dir of BUILT_DIRS) walk(join(ROOT, dir), targets);
} else {
  for (const dir of SOURCE_DIRS) walk(join(ROOT, dir), targets);
  for (const file of SOURCE_FILES) {
    try {
      if (statSync(join(ROOT, file)).isFile()) targets.push(join(ROOT, file));
    } catch {
      /* 不存在就算了 */
    }
  }
}

const localKey = fingerprint();
const hits = [];

for (const file of targets) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (BINARY_RE.test(rel)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  // 本机 Key 原文（最严格：任何位置出现都不行）
  if (localKey && text.includes(localKey)) {
    hits.push(`${rel}  出现了本机真实 Key（${localKey.slice(0, 3)}…${localKey.slice(-4)}）`);
  }
  for (const match of text.matchAll(KEY_RE)) {
    if (PLACEHOLDER_RE.test(match[0])) continue;
    if (localKey && match[0] === localKey) continue; // 上面已单独报过
    const line = text.slice(0, match.index).split('\n').length;
    hits.push(`${rel}:${line}  ${match[0].slice(0, 8)}…`);
  }
}

// 内置 Key 常量必须是空的
try {
  const app = readFileSync(join(ROOT, 'src/config/app.ts'), 'utf8');
  const m = app.match(/DEFAULT_AI_API_KEY\s*=\s*'([^']*)'/);
  if (m && m[1].trim().length > 0) {
    hits.push('src/config/app.ts  内置 DEFAULT_AI_API_KEY 不是空的（安装包会带上 Key）');
  }
} catch {
  /* ignore */
}

if (hits.length > 0) {
  console.error(`[check-secrets] 发现问题（扫描 ${targets.length} 个文件${withBuilt ? '，含构建产物' : ''}）：`);
  for (const hit of hits) console.error('  - ' + hit);
  console.error('\n真实 Key 只允许放在 %APPDATA%\\photo-story\\data\\ai-config.json，不要写进仓库或构建产物。');
  process.exit(1);
}

console.log(
  `[check-secrets] OK：${targets.length} 个文件${withBuilt ? '（含构建产物）' : ''}里没有真实 Key，内置 Key 为空` +
    (localKey ? '（已按本机 Key 指纹核对）' : '（未找到本机 Key，仅做格式检查）'),
);
