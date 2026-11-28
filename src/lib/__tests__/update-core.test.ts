// @vitest-environment node
// 更新判定逻辑的单测。electron/update-core.cjs 是纯 CJS、不依赖 Electron，
// 所以能直接在 node 环境里 require 进来（主进程里也用同一份，不再各写一套）。
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface DecideResult {
  ok: boolean;
  current: string;
  latest: string;
  currentBuild: string | null;
  latestBuild: string | null;
  repack: boolean;
  hasUpdate: boolean;
  assetName: string | null;
  assetUrl: string | null;
}

interface UpdateCore {
  compareVersion: (a: string, b: string) => number;
  compareBuild: (a: string | null, b: string | null) => number;
  readBuildStamp: (body: string) => string | null;
  pickSetupAsset: (assets: unknown) => { name: string; url: string | null; size: number | null } | null;
  decideUpdate: (input: { current: string; currentBuild?: string | null; release: unknown }) => DecideResult;
}

const nodeRequire = createRequire(import.meta.url);
const core = nodeRequire('../../../electron/update-core.cjs') as UpdateCore;

const release = (tag: string, body = '', assets: unknown[] = []) => ({
  tag_name: tag,
  body,
  assets,
  published_at: '2026-11-28T00:00:00Z',
});

const setupAsset = { name: 'PhotoStory-0.8.2-setup.exe', browser_download_url: 'https://x/y.exe', size: 86 };

describe('compareVersion', () => {
  it('比主次修订号', () => {
    expect(core.compareVersion('0.8.2', '0.8.1')).toBe(1);
    expect(core.compareVersion('v0.8.1', '0.8.1')).toBe(0);
    expect(core.compareVersion('0.9.0', '0.10.0')).toBe(-1);
  });

  it('解析不出来的当相等，不误报有新版', () => {
    expect(core.compareVersion('abc', '0.8.1')).toBe(0);
  });
});

describe('build 标记', () => {
  it('能从 Release 正文里读出来（大小写不敏感，读成小写）', () => {
    expect(core.readBuildStamp('说明\n<!-- build:20261128A -->\n')).toBe('20261128a');
    expect(core.readBuildStamp('没有标记')).toBeNull();
  });

  it('日期加当日序号，按字符串比大小就够', () => {
    expect(core.compareBuild('20261128b', '20261128a')).toBe(1);
    expect(core.compareBuild('20261128a', '20261128a')).toBe(0);
    // 缺一侧当作不知道，不据此提示更新
    expect(core.compareBuild(null, '20261128a')).toBe(0);
  });
});

describe('pickSetupAsset', () => {
  it('只认 -setup.exe 结尾的附件', () => {
    expect(core.pickSetupAsset([setupAsset])?.name).toBe('PhotoStory-0.8.2-setup.exe');
    expect(core.pickSetupAsset([{ name: 'PhotoStory-0.8.2.zip' }])).toBeNull();
    expect(core.pickSetupAsset(null)).toBeNull();
  });
});

describe('decideUpdate', () => {
  it('版本更高：有更新，不是重打包', () => {
    const result = core.decideUpdate({
      current: '0.8.2',
      currentBuild: '20261128a',
      release: release('v0.8.3', '<!-- build:20261201a -->', [setupAsset]),
    });
    expect(result.hasUpdate).toBe(true);
    expect(result.repack).toBe(false);
    expect(result.latest).toBe('0.8.3');
    expect(result.assetUrl).toBe('https://x/y.exe');
  });

  it('版本相同、云上标记更新：算重打的修复包，也要提示', () => {
    const result = core.decideUpdate({
      current: '0.8.2',
      currentBuild: '20261128a',
      release: release('v0.8.2', '<!-- build:20261129b -->', [setupAsset]),
    });
    expect(result.hasUpdate).toBe(true);
    expect(result.repack).toBe(true);
    expect(result.latestBuild).toBe('20261129b');
  });

  it('版本相同、标记一样：已是最新', () => {
    const result = core.decideUpdate({
      current: '0.8.2',
      currentBuild: '20261128a',
      release: release('v0.8.2', '<!-- build:20261128a -->', [setupAsset]),
    });
    expect(result.hasUpdate).toBe(false);
    expect(result.repack).toBe(false);
  });

  it('本机版本更低就提示（老安装包里没有 build 逻辑，靠版本号救）', () => {
    const result = core.decideUpdate({
      current: '0.8.1',
      currentBuild: null,
      release: release('v0.8.2', '', [setupAsset]),
    });
    expect(result.hasUpdate).toBe(true);
  });

  it('没有 tag_name 就是失败结果，不会崩', () => {
    const result = core.decideUpdate({ current: '0.8.2', release: { tag_name: '' } });
    expect(result.ok).toBe(false);
  });
});
