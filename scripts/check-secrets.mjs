#!/usr/bin/env node
/**
 * 提交前/CI 的密钥检查：仓库里不该出现任何形如 sk-xxxx 的真实 Key。
 *
 * 规则（本项目约定）：
 *  - 源码里的 DEFAULT_AI_API_KEY 必须是空字符串 —— 安装包里不能带 Key。
 *  - 真实的 Key 只存在本机运行时配置里：
 *      %APPDATA%\photo-story\data\ai-config.json
 *    那个文件在仓库外，永远不会被打包、也永远不会被提交。
 *  - 任何脚本、文档、示例里出现的 Key 必须写成占位符（sk-your-key-here / sk-REPLACE…）。
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const IGNORED_PATHS = ['.devtools/', 'node_modules/', '安装包/', 'dist-electron/', 'dist-build/'];

let files;
try {
  files = execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
} catch {
  console.error('[check-secrets] 不在 git 仓库里，跳过');
  process.exit(0);
}

const KEY_RE = /sk-[A-Za-z0-9]{20,}/g;
const PLACEHOLDER_RE = /sk-(your-key-here|REPLACE|xxx|YOUR|placeholder|test)/i;
const BINARY_RE = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|asar|exe|zip|7z|docx|pptx|pdf|mp4|wasm)$/i;

const hits = [];
for (const file of files) {
  if (IGNORED_PATHS.some((prefix) => file.startsWith(prefix))) continue;
  if (BINARY_RE.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const match of text.matchAll(KEY_RE)) {
    if (PLACEHOLDER_RE.test(match[0])) continue;
    const line = text.slice(0, match.index).split('\n').length;
    hits.push(`${file}:${line}  ${match[0].slice(0, 8)}…`);
  }
}

// 额外一条：内置 Key 常量必须是空的
try {
  const app = readFileSync('src/config/app.ts', 'utf8');
  const m = app.match(/DEFAULT_AI_API_KEY\s*=\s*'([^']*)'/);
  if (m && m[1].trim().length > 0) {
    hits.push(`src/config/app.ts  内置 DEFAULT_AI_API_KEY 不是空的（安装包会带上 Key）`);
  }
} catch {
  /* 文件不存在就算了 */
}

if (hits.length > 0) {
  console.error('[check-secrets] 发现问题：');
  for (const hit of hits) console.error('  - ' + hit);
  console.error('\n真实 Key 请放到 %APPDATA%\\photo-story\\data\\ai-config.json，不要写进仓库。');
  process.exit(1);
}

console.log(`[check-secrets] OK：${files.length} 个受版本控制的文件里没有真实 Key，内置 Key 为空`);