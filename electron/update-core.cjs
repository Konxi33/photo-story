// electron/update-core.cjs
// 应用内更新里「怎么判要不要提示」的纯逻辑，不依赖 Electron，方便单测。
//
// 为什么要单独一个文件（0.8.2）：
// 版本号相同、只是重新打了安装包的情况以前判不出来 —— 已经装了 0.8.1 旧包的人
// 点「检查更新」永远得到「已是最新」。现在给每个安装包打一个 build 标记
// （写在 Release 正文里的 <!-- build:20261128a -->），同版本但标记更新也算有更新。
// 版本号仍然是主要判据，标记只是补丁，避免以后重打同版本又卡住用户。

/** 解析成 [major, minor, patch]，允许 "v0.5.7" 或 "0.5.7-beta.1"；解析失败返回 null */
function parseVersionParts(input) {
  const matched = String(input || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!matched) return null;
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

/** a > b 返回 1，相等 0，小于 -1；解析失败按 0 处理（不会误报有新版） */
function compareVersion(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

/** 从 Release 正文里读安装包标记：<!-- build:20261128a --> */
function readBuildStamp(body) {
  const matched = String(body || '').match(/<!--\s*build:([0-9a-z.-]+)\s*-->/i);
  return matched ? matched[1].toLowerCase() : null;
}

/**
 * build 标记形如 20261128a：前面是日期，后面是当天的序号。
 * 用同一格式的字符串比较即可（定长日期 + 小写字母后缀）。
 * 任一侧缺失就当作「不知道」，返回 0，不据此提示更新。
 */
function compareBuild(a, b) {
  if (!a || !b) return 0;
  const left = String(a).toLowerCase();
  const right = String(b).toLowerCase();
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

/** 在 assets 里找安装包：附件名以 -setup.exe 结尾 */
function pickSetupAsset(assets) {
  if (!Array.isArray(assets)) return null;
  const hit = assets.find(
    (asset) => asset && typeof asset.name === 'string' && /-setup\.exe$/i.test(asset.name),
  );
  if (!hit) return null;
  return {
    url: typeof hit.browser_download_url === 'string' ? hit.browser_download_url : null,
    name: hit.name,
    size: typeof hit.size === 'number' ? hit.size : null,
  };
}

/**
 * 决定这次检查的结果。
 * @param {{ current: string, currentBuild?: string|null, release: object }} input
 * release 是 GitHub Release 对象（tag_name / body / assets / published_at）。
 */
function decideUpdate(input) {
  const release = input.release || {};
  const latest = String(release.tag_name || '')
    .replace(/^v/i, '')
    .trim();
  if (!latest) return { ok: false, error: 'Release 里没有读到版本号（tag_name 为空）' };

  const current = String(input.current || '');
  const latestBuild = readBuildStamp(release.body);
  const currentBuild = input.currentBuild ? String(input.currentBuild).toLowerCase() : null;

  const versionNewer = compareVersion(latest, current) > 0;
  // 版本相同、但安装包标记更新：说明是同版本重打的修复包
  const repack = !versionNewer && compareVersion(latest, current) === 0 && compareBuild(latestBuild, currentBuild) > 0;

  const asset = pickSetupAsset(release.assets);
  return {
    ok: true,
    current,
    latest,
    currentBuild,
    latestBuild,
    repack,
    hasUpdate: versionNewer || repack,
    notes: typeof release.body === 'string' ? release.body : '',
    assetUrl: asset ? asset.url : null,
    assetName: asset ? asset.name : null,
    assetSize: asset ? asset.size : null,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
  };
}

module.exports = {
  parseVersionParts,
  compareVersion,
  readBuildStamp,
  compareBuild,
  pickSetupAsset,
  decideUpdate,
};
