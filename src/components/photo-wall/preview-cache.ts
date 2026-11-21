// src/components/photo-wall/preview-cache.ts
// 照片墙的预览图缓存。
//
// 为什么需要它：照片墙一次会挂上几百个方块，如果每块自己 await AssetRepository.get()
// 再去 createObjectURL，上千张照片会同时掀起几百个 IndexedDB 事务 + 几百次解码，
// 首屏直接卡住（原来的 page.tsx 是「进来就把所有 preview 全转成 URL」，正是卡顿的大头）。
//
// 这里的策略：
//   1. 只有方块真正挂到视口里才请求（由 <WallTile> 的 effect 触发），按需加载；
//   2. 并发上限 6，其余排队，避免 IndexedDB / 解码线程被打满；
//   3. 同一个 photoId 只请求一次（inflight 去重）；
//   4. 结果按 LRU 存活，超过上限时 revoke 最旧的 URL，避免内存无上限增长。
//
// 注意：revoke 只发生在缓存淘汰时，绝不在方块卸载时 revoke——
// 方块频繁进出售口，卸载即 revoke 会让同一张图反复重建 URL（闪烁的另一个来源）。

'use client';

import { AssetRepository } from '@/lib/db';

/** 同时只允许这么多个 blob 读取 + 解码在飞（拖动时一屏方块会成批涌入，给到 10 才不积压） */
const MAX_CONCURRENT = 10;
/** 最多保留多少个 objectURL（≈ 一个屏幕的方块数 × 1.5） */
const MAX_LIVE = 640;

/** photoId -> objectURL，插入顺序即 LRU 顺序（队首最旧） */
const live = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const queue: (() => void)[] = [];
let running = 0;

function drain(): void {
  while (running < MAX_CONCURRENT) {
    const job = queue.shift();
    if (!job) return;
    running += 1;
    job();
  }
}

function release(): void {
  running = Math.max(0, running - 1);
  drain();
}

function evict(): void {
  while (live.size > MAX_LIVE) {
    const oldest = live.keys().next();
    if (oldest.done) return;
    const url = live.get(oldest.value);
    live.delete(oldest.value);
    if (url) URL.revokeObjectURL(url);
  }
}

/** 只查缓存，命中时把它挪到队尾（LRU 触碰） */
export function peekPreview(photoId: string): string | null {
  const url = live.get(photoId);
  if (!url) return null;
  live.delete(photoId);
  live.set(photoId, url);
  return url;
}

/** 取预览图 URL：命中缓存同步返回，未命中则排队读取 blob */
export function loadPreview(photoId: string): Promise<string | null> {
  const hit = peekPreview(photoId);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(photoId);
  if (pending) return pending;

  const task = new Promise<string | null>((resolve) => {
    queue.push(() => {
      void (async () => {
        let url: string | null = null;
        try {
          const asset = await AssetRepository.get(photoId, 'preview');
          if (asset) url = URL.createObjectURL(asset.blob);
        } catch {
          url = null;
        }
        if (url) {
          live.set(photoId, url);
          evict();
        }
        inflight.delete(photoId);
        release();
        resolve(url);
      })();
    });
    drain();
  });

  inflight.set(photoId, task);
  return task;
}

/** 离开照片库时清空，别把几十 MB 的 URL 留在内存里 */
export function clearPreviewCache(): void {
  for (const url of live.values()) URL.revokeObjectURL(url);
  live.clear();
  queue.length = 0;
}

/** 调试用：当前缓存规模 */
export function previewCacheStats(): { live: number; inflight: number; queued: number } {
  return { live: live.size, inflight: inflight.size, queued: queue.length };
}
