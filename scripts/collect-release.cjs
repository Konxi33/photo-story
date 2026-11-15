// scripts/collect-release.cjs
// 打包完成后自动归档：把安装包按版本收进「安装包/<版本>/」，并重建 INDEX.md。
// 用法：node scripts/collect-release.cjs [源目录]，默认读 dist-electron。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = process.cwd();
const RELEASE_DIR = path.join(ROOT, '安装包');
const SOURCE_DIR = path.resolve(ROOT, process.argv[2] || 'dist-electron');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex').toUpperCase();
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

const README = `照片故事 v${version} · 安装说明
================================

一、安装
  1. 双击「照片故事-${version}-安装版.exe」。
  2. 出现「Windows 已保护你的电脑」时，点「更多信息」→「仍要运行」。
     （安装包没有购买代码签名证书，这是正常现象，不是病毒。）
  3. 无需管理员权限，几秒装完；桌面与开始菜单会出现「照片故事」。
  4. 只提供安装版（不再出便携版）。装好后从桌面/开始菜单启动，1–2 秒打开。

二、首次使用要填 API Key
  安装包不含密钥。打开软件 → 左侧「设置」→「模型与密钥」，
  默认服务商是 DeepSeek，到 https://platform.deepseek.com 创建 API Key 粘贴即可；
  也可以用智谱（https://open.bigmodel.cn ，glm-4v-flash 免费）。

三、数据位置
  · 项目与照片：本机应用数据目录（设置页可点「打开」查看）
  · AI 配置：%APPDATA%\\photo-story\\data\\ai-config.json
  · 只有识别时会把当次那张图片发给模型服务商，其余不上传。

四、换电脑
  项目卡片右上角「⋯」→「备份」，会下载一个 .json（含原图与文字）。
  新机器上「导入备份」即可恢复。

五、版本说明
  见同目录上一级的 INDEX.md。
`;

function main() {
  const installer = path.join(SOURCE_DIR, `照片故事-${version}-安装版.exe`);

  if (!fs.existsSync(installer)) {
    console.error(`[collect] 没找到安装包：${installer}`);
    console.error('[collect] 请先执行 electron-builder，或传入正确的源目录。');
    process.exit(1);
  }

  const targetDir = path.join(RELEASE_DIR, version);
  fs.mkdirSync(targetDir, { recursive: true });

  fs.copyFileSync(installer, path.join(targetDir, `照片故事-${version}-安装版.exe`));
  fs.writeFileSync(path.join(targetDir, '安装说明.txt'), README, 'utf8');

  // 重建索引：以磁盘为准，按版本倒序
  const dirs = fs
    .readdirSync(RELEASE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i += 1) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });

  const rows = [];
  for (const dir of dirs) {
    const full = path.join(RELEASE_DIR, dir);
    const files = fs.readdirSync(full).filter((name) => name.endsWith('.exe'));

    for (const name of files) {
      const file = path.join(full, name);
      const stat = fs.statSync(file);
      const date = `${stat.mtime.getFullYear()}-${pad(stat.mtime.getMonth() + 1)}-${pad(stat.mtime.getDate())}`;
      rows.push({
        version: dir,
        name,
        relative: `${dir}/${name}`,
        size: mb(stat.size),
        date,
        hash: sha256(file).slice(0, 16),
      });
    }
  }

  const indexLines = [
    '# 安装包索引',
    '',
    `本目录保存所有版本的安装包（只提供安装版），最近一次归档：${new Date().toLocaleString('zh-CN')}`,
    '',
    '| 版本 | 文件 | 大小 | 构建日期 | SHA256(前16位) |',
    '|---|---|---|---|---|',
    ...rows.map(
      (row) =>
        `| ${row.version} | [${row.name}](${encodeURI(row.relative)}) | ${row.size} | ${row.date} | \`${row.hash}\` |`,
    ),
    '',
    '## 说明',
    '',
    '- 每次发版执行打包脚本后，会自动把新版本收进本目录并更新此索引。',
    '- **只出安装版**：双击安装，写入 `%LOCALAPPDATA%\\Programs\\photo-story`，有桌面/开始菜单快捷方式，启动 1–2 秒。',
    '- 安装包不含 API Key，首次使用需在「设置」里自行填写。',
    '- 未签名安装包首次运行会被 SmartScreen 拦一次：更多信息 → 仍要运行。',
    '',
    '### 历史缺口',
    '',
    '0.2.0 / 0.2.1 / 0.3.1 的安装包在早期迭代时被清理，未保留。若需要，可从对应版本的源码重新打包。',
    '',
  ];

  fs.writeFileSync(path.join(RELEASE_DIR, 'INDEX.md'), indexLines.join('\n'), 'utf8');

  console.log(`[collect] 已归档 v${version} → 安装包/${version}/`);
  for (const row of rows.filter((r) => r.version === version)) {
    console.log(`           ${row.name}  ${row.size}  ${row.hash}`);
  }
}

main();
