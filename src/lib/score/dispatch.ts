// src/lib/score/dispatch.ts
// 评分分发：按设置决定用「AI 评分」还是「本地像素评分」。

import { STORAGE_KEY_APP_SETTINGS } from '@/config/app';
import { scorePhotoLocally } from '@/lib/ai/client';
import { KvRepository } from '@/lib/db';
import type { AppSettings, ScoreResult } from '@/types/domain';

import { computeLocalScore } from './localScore';

const LOCAL_META = {
  provider: 'local',
  model: 'pixel-metrics',
  promptVersion: 'local-1',
  temperature: 0,
  latencyMs: 0,
  responseFormat: 'json_object' as const,
  warnings: ['本地像素评分：只看曝光/清晰度/色彩，不判断内容'],
};

export async function scorePhoto(
  photoId: string,
  blob: Blob,
  mime: string,
  signal?: AbortSignal,
): Promise<ScoreResult> {
  const settings = await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS).catch(
    () => null,
  );

  if (settings?.scoreEngine === 'local') {
    const local = await computeLocalScore(blob);
    if (local) {
      return {
        ok: true,
        score: local.score,
        scoreAdvice: local.advice,
        meta: LOCAL_META,
      };
    }
  }

  return scorePhotoLocally(photoId, blob, mime, signal);
}
