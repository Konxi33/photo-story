// src/lib/storage/usage.ts
'use client';

import type { StorageUsage } from '@/types/domain';

export type StorageUsageInfo = StorageUsage & {
  persistedLabel: string;
};

let persistRequested = false;

export async function getStorageUsage(): Promise<StorageUsageInfo> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { usage: 0, quota: 0, persisted: false, persistedLabel: '未持久化' };
  }

  let usage = 0;
  let quota = 0;
  let persisted = false;

  try {
    const estimate = await navigator.storage.estimate();
    usage = estimate.usage ?? 0;
    quota = estimate.quota ?? 0;
  } catch {
    // 隐私模式下可能抛错，保持 0
  }

  try {
    if (typeof navigator.storage.persisted === 'function') {
      persisted = await navigator.storage.persisted();
    }
    if (!persisted && !persistRequested && typeof navigator.storage.persist === 'function') {
      persistRequested = true;
      persisted = await navigator.storage.persist();
    }
  } catch {
    // 申请失败不影响展示
  }

  return {
    usage,
    quota,
    persisted,
    persistedLabel: persisted ? '已持久化' : '未持久化',
  };
}
