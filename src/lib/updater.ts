// src/lib/updater.ts
// 应用内更新：检查新版本、下载并安装、记录「待提示」的更新信息。
// 联网一律交给 Electron 主进程的 net.fetch / net.request（Chromium 网络栈）：
// 这台机器的 TLS 被中间设备接管，Node 的 fetch 直连 api.github.com 会直接 fetch failed。
// 浏览器里没有桌面桥，所有函数都友好地返回失败，不抛异常。

import { APP_VERSION } from '@/config/app';
import { formatBytes } from '@/lib/utils';

/** 一次检查结果（主进程解析 GitHub Release 后传来） */
export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  /**
   * 0.8.2：同版本重打的修复包。
   * 版本号一样，但云上那个安装包的 build 标记比本机新 —— 已经装了同版本旧包的人
   * 也能收到提示，不再永远显示「已是最新」。
   */
  repack?: boolean;
  /** 本机安装包的构建标记，如 20261128a */
  currentBuild?: string | null;
  /** 云上安装包的构建标记 */
  latestBuild?: string | null;
  /** Release body，中文更新日志全文 */
  notes: string;
  assetUrl: string | null;
  assetName: string | null;
  assetSize: number | null;
  /** ISO 时间字符串，如 2026-11-01T12:00:00Z */
  publishedAt: string | null;
}

export interface UpdateCheckOutcome {
  ok: boolean;
  info?: UpdateInfo;
  error?: string;
}

export interface UpdateProgress {
  received: number;
  total: number;
}

export interface UpdateInstallOutcome {
  ok: boolean;
  filePath?: string;
  error?: string;
}

/** 上次检查时间（毫秒时间戳） */
const CHECKED_AT_KEY = 'ps:update-checked-at';
/** 待提示的更新（只有发现新版时才写） */
const PENDING_KEY = 'ps:update-info';
/** 检查节流：1 小时内不重复打 GitHub 接口 */
const THROTTLE_MS = 60 * 60 * 1000;

function getBridge(): Window['photoStory'] {
  if (typeof window === 'undefined') return undefined;
  return window.photoStory;
}

function readStored<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式 / 配额满：更新提示失败不影响主流程
  }
}

function removeStored(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 忽略
  }
}

function normalizeInfo(raw: {
  current?: string;
  latest?: string;
  hasUpdate?: boolean;
  repack?: boolean;
  currentBuild?: string | null;
  latestBuild?: string | null;
  notes?: string;
  assetUrl?: string | null;
  assetName?: string | null;
  assetSize?: number | null;
  publishedAt?: string | null;
}): UpdateInfo {
  return {
    current: typeof raw.current === 'string' && raw.current ? raw.current : APP_VERSION,
    latest: typeof raw.latest === 'string' ? raw.latest : APP_VERSION,
    hasUpdate: raw.hasUpdate === true,
    repack: raw.repack === true,
    currentBuild: typeof raw.currentBuild === 'string' ? raw.currentBuild : null,
    latestBuild: typeof raw.latestBuild === 'string' ? raw.latestBuild : null,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    assetUrl: typeof raw.assetUrl === 'string' && raw.assetUrl ? raw.assetUrl : null,
    assetName: typeof raw.assetName === 'string' && raw.assetName ? raw.assetName : null,
    assetSize: typeof raw.assetSize === 'number' ? raw.assetSize : null,
    publishedAt: typeof raw.publishedAt === 'string' && raw.publishedAt ? raw.publishedAt : null,
  };
}

/**
 * 检查新版本。桌面端才可用；默认 1 小时内不重复请求（force 跳过节流）。
 * 发现新版时会把 info 写进 localStorage ps:update-info，供下次启动弹提示。
 */
export async function checkForUpdate(force = false): Promise<UpdateCheckOutcome> {
  const bridge = getBridge();
  if (!bridge?.checkForUpdate) {
    return { ok: false, error: '浏览器里不支持自动更新' };
  }

  if (!force) {
    const checkedAt = readStored<number>(CHECKED_AT_KEY);
    if (typeof checkedAt === 'number' && Date.now() - checkedAt < THROTTLE_MS) {
      const pending = readPendingUpdate();
      if (pending) return { ok: true, info: pending };
      return { ok: false, error: '刚检查过（1 小时内不重复请求），过一会儿再试' };
    }
  }

  try {
    const raw = await bridge.checkForUpdate({ force });
    if (!raw || !raw.ok) {
      return { ok: false, error: raw?.error || '检查更新失败' };
    }

    const info = normalizeInfo(raw);
    writeStored(CHECKED_AT_KEY, Date.now());
    if (info.hasUpdate) {
      writeStored(PENDING_KEY, info);
    } else {
      clearPendingUpdate();
    }
    return { ok: true, info };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 下载安装包并启动安装程序。
 * onProgress 会收到主进程 update:progress 事件（total 为 0 表示拿不到文件大小）。
 */
export async function downloadAndInstall(
  info: UpdateInfo,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<UpdateInstallOutcome> {
  const bridge = getBridge();
  if (!bridge?.downloadUpdate) {
    return { ok: false, error: '浏览器里不支持自动更新' };
  }
  if (!info.assetUrl) {
    return { ok: false, error: '这个版本没有可下载的安装包' };
  }

  const unsubscribe =
    onProgress && bridge.onUpdateProgress
      ? bridge.onUpdateProgress((progress) => onProgress(progress))
      : null;

  try {
    const downloaded = await bridge.downloadUpdate(
      info.assetUrl,
      info.assetName ?? 'photo-story-setup.exe',
    );
    if (!downloaded || !downloaded.ok || !downloaded.filePath) {
      return { ok: false, error: downloaded?.error || '下载安装包失败' };
    }

    const installed = await bridge.installUpdate?.(downloaded.filePath);
    if (!installed || !installed.ok) {
      return {
        ok: false,
        filePath: downloaded.filePath,
        error: installed?.error || '安装程序启动失败',
      };
    }

    return { ok: true, filePath: downloaded.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    unsubscribe?.();
  }
}

/** 读出「待提示」的新版本信息；没有或已失效返回 null */
export function readPendingUpdate(): UpdateInfo | null {
  const stored = readStored<Partial<UpdateInfo>>(PENDING_KEY);
  if (!stored || typeof stored.latest !== 'string' || !stored.latest) return null;
  if (stored.hasUpdate === false) return null;
  return { ...normalizeInfo(stored), hasUpdate: true };
}

/** 清掉「待提示」记录（安装已开始或不希望再提示时调用） */
export function clearPendingUpdate(): void {
  removeStored(PENDING_KEY);
}

/** 把字节数说成「81.9 MB」；大小未知时给一句人话 */
export function describeSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '大小未知';
  return formatBytes(bytes);
}