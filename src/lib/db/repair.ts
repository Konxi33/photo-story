// src/lib/db/repair.ts
'use client';

import { PHOTO_ERROR_LABELS } from '@/config/app';

import { getDB } from './client';
import { PhotoRepository } from './repository';

/**
 * 把上次被刷新/关闭打断、卡在 processing 的照片统一标为 failed。
 * 首页调用，失败只打日志，绝不阻塞页面。
 */
export async function repairInterruptedPhotos(): Promise<number> {
  try {
    const db = await getDB();
    const all = await db.getAll('photos');
    const ids = all.filter((p) => p.status === 'processing').map((p) => p.id);
    if (ids.length === 0) return 0;

    await PhotoRepository.updateMany(ids, {
      status: 'failed',
      error: {
        code: 'INTERRUPTED',
        message: PHOTO_ERROR_LABELS.INTERRUPTED,
        retryable: true,
        attempts: 1,
        at: Date.now(),
      },
    });

    return ids.length;
  } catch (error) {
    console.warn('[db] 中断状态修复失败', error);
    return 0;
  }
}
