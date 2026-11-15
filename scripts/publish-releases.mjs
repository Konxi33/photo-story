#!/usr/bin/env node
/**
 * 把 更新日志_<版本>.md 批量发布成 GitHub Releases。
 *
 * 用法（PowerShell）：
 *   $env:GH_TOKEN = "ghp_xxx"          # 需要 repo 权限的 token
 *   $env:GH_REPO  = "用户名/photo-story"
 *   node scripts/publish-releases.cjs            # 先看会发什么（dry run）
 *   node scripts/publish-releases.cjs --apply     # 真正创建
 *   node scripts/publish-releases.cjs --apply --asset-dir 安装包   # 顺带挂安装包附件
 *
 * 约定：
 * - 标签名 v<版本>，例如 v0.5.6
 * - Release 说明 = docs/更新日志_<版本>.md 全文
 * - 附件：<asset-dir>/<版本>/照片故事-<版本>-安装版.exe（存在才挂）
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const assetDirIdx = process.argv.indexOf('--asset-dir');
const ASSET_DIR = assetDirIdx > -1 ? process.argv[assetDirIdx + 1] : null;

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = process.env.GH_REPO;
if (!REPO) {
  console.error('缺少 GH_REPO（形如 用户名/photo-story）');
  process.exit(1);
}
if (APPLY && !TOKEN) {
  console.error('缺少 GH_TOKEN（需要 repo 权限的 personal access token）');
  process.exit(1);
}

const compare = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/** 更新日志统一放在 docs/ 下（仓库根目录保持干净）。 */
const NOTES_DIR = 'docs';

const notes = readdirSync(NOTES_DIR)
  .map((name) => /^更新日志_(\d+\.\d+\.\d+)\.md$/.exec(name))
  .filter(Boolean)
  .map((m) => ({ version: m[1], file: `${NOTES_DIR}/${m[0]}` }))
  .sort((a, b) => compare(a.version, b.version));

if (notes.length === 0) {
  console.error('docs/ 下没有 更新日志_<版本>.md');
  process.exit(1);
}

/** 与 src/config/changelogs.ts 保持一致的版本别名（Release 标题用）。 */
const TITLES = {
  '0.3.0': 'AI 文案系统重做',
  '0.3.2': '评分与深色',
  '0.3.3': '评分入口与算法',
  '0.3.4': '评分页、项目包、主题',
  '0.3.5': '主菜单与动效',
  '0.3.6': '安装器、照片墙与侧栏',
  '0.4.0': '侧栏、删除与本地评分',
  '0.4.1': '黏合滑块与命令面板',
  '0.4.2': '读得懂照片，也看得清水平',
  '0.5.0': '会挑片，也会看水平',
  '0.5.1': '慢一点，好一点',
  '0.5.2': '会编排，也看得清暗处',
  '0.5.3': '六个模块，各管一段',
  '0.5.4': '为打印而排',
  '0.5.5': '看得懂，也印得像本书',
  '0.5.6': '删错了还能捡回来',
};

function releaseTitle(_body, version) {
  const tagline = TITLES[version];
  return tagline ? `${version} · ${tagline}` : `照片故事 ${version}`;
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'photo-story-release-script',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${res.status} ${path} → ${text.slice(0, 300)}`);
  return json;
}

async function uploadAsset(uploadUrl, filePath, fileName) {
  const template = uploadUrl.replace('{?name,label}', '');
  const url = `${template}?name=${encodeURIComponent(fileName)}`;
  const buf = readFileSync(filePath);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length),
      'User-Agent': 'photo-story-release-script',
    },
    body: buf,
  });
  if (!res.ok) throw new Error(`上传附件失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

for (const { version, file } of notes) {
  const body = readFileSync(file, 'utf8');
  const tag = `v${version}`;
  const title = releaseTitle(body, version);

  let asset = null;
  if (ASSET_DIR) {
    const candidate = join(ASSET_DIR, version, `照片故事-${version}-安装版.exe`);
    if (existsSync(candidate)) asset = candidate;
  }

  console.log(`\n== ${tag} — ${title}${asset ? `  (+${(statSync(asset).size / 1048576).toFixed(1)} MB 附件)` : ''}`);
  if (!APPLY) continue;

  try {
    const release = await api(`/repos/${REPO}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: title,
        body,
        target_commitish: 'main',
        draft: false,
        prerelease: false,
      }),
    });
    console.log(`   已创建 ${release.html_url}`);
    if (asset) {
      await uploadAsset(release.upload_url, asset, `照片故事-${version}-安装版.exe`);
      console.log('   附件已上传');
    }
  } catch (error) {
    console.error(`   失败：${error.message}`);
    process.exitCode = 1;
  }
}

if (!APPLY) console.log('\n（dry run，加 --apply 才会真的创建）');
