// src/lib/export/output.ts
// 0.5.4：统一的「文件落到哪里」逻辑。
// 设置里指定了固定导出目录就直接写进去（不再弹保存框）；没有就退回浏览器下载。
'use client';

import { KvRepository } from '@/lib/db';
import { DEFAULT_APP_SETTINGS, STORAGE_KEY_APP_SETTINGS } from '@/config/app';
import type { AppSettings } from '@/types/domain';

export type SaveMode = 'fixed-dir' | 'download';

export interface SaveOutcome {
  fileName: string;
  mode: SaveMode;
  /** 固定目录写入成功时的完整路径 */
  filePath?: string;
  /** 固定目录写入失败时的原因（此时已回退为下载） */
  failedReason?: string;
}

function desktop() {
  return typeof window !== 'undefined' ? window.photoStory : undefined;
}

/** 把 Blob 交给浏览器下载 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveDocument(
  blob: Blob,
  fileName: string,
  outputDir?: string,
): Promise<SaveOutcome> {
  const api = desktop();
  const dir = (outputDir ?? '').trim();
  if (api?.saveToDirectory && dir) {
    try {
      const data = new Uint8Array(await blob.arrayBuffer());
      const result = await api.saveToDirectory({ dir, fileName, data });
      if (result.ok && result.path) {
        return { fileName, mode: 'fixed-dir', filePath: result.path };
      }
      downloadBlob(blob, fileName);
      return {
        fileName,
        mode: 'download',
        failedReason: result.error ?? '写入导出目录失败',
      };
    } catch (error) {
      downloadBlob(blob, fileName);
      return {
        fileName,
        mode: 'download',
        failedReason: error instanceof Error ? error.message : '写入导出目录失败',
      };
    }
  }
  downloadBlob(blob, fileName);
  return { fileName, mode: 'download' };
}

/** 在资源管理器里选中刚导出的文件 */
export async function revealFile(filePath?: string): Promise<void> {
  if (!filePath) return;
  await desktop()?.showItemInFolder?.(filePath);
}

/** 读设置里的固定导出目录（导出对话框与导出流程共用） */
export async function readExportDir(): Promise<string> {
  try {
    const saved = await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS);
    return saved?.exportDir?.trim() ?? '';
  } catch {
    return '';
  }
}

/** 读「导出后是否自动定位文件」 */
export async function readRevealAfterExport(): Promise<boolean> {
  try {
    const saved = await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS);
    return saved?.revealAfterExport !== false;
  } catch {
    return true;
  }
}

/** 写回固定的导出目录（导出对话框里直接改，设置页读同一个键） */
export async function writeExportDir(dir: string): Promise<void> {
  const saved = await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS);
  const next: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...(saved ?? {}),
    exportDir: dir.trim(),
  };
  await KvRepository.set(STORAGE_KEY_APP_SETTINGS, next);
}
