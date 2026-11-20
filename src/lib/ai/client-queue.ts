// src/lib/ai/client-queue.ts
// 浏览器端批量队列：并发池 + 退避重试 + 可中断 + 逐张落库。

import {
  MAX_CONCURRENCY,
  PHOTO_ERROR_LABELS,
  PHOTO_ERROR_RETRYABLE,
  RETRY_BASE_DELAY_MS,
  RETRY_JITTER_MS,
} from '@/config/app';
import { AssetRepository, PhotoRepository } from '@/lib/db';
import { sleep } from '@/lib/utils';
import type {
  AnalyzeResponse,
  AnalyzeStyleOptions,
  AnalysisMeta,
  BatchRunSummary,
  Photo,
  PhotoError,
  PhotoErrorCode,
} from '@/types/domain';

import { analyzePhotoLocally } from './client';

export interface BatchAnalyzeOptions {
  photos: Photo[];
  concurrency: number;
  maxRetries: number;
  timeoutMs: number;
  /** 风格与已有标题（用于避免同批重名） */
  style?: AnalyzeStyleOptions;
  onPhotoStart: (id: string) => void;
  onPhotoSuccess: (id: string, result: AnalyzeResponse, photo: Photo | null) => void;
  onPhotoError: (id: string, error: PhotoError, photo: Photo | null) => void;
  shouldStop: () => boolean;
}

const backoff = (attempt: number): number =>
  Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), 8000) +
  Math.random() * RETRY_JITTER_MS;

function toPhotoError(error: unknown, attempts: number): PhotoError {
  const raw = error as { code?: PhotoErrorCode; message?: string };
  const code: PhotoErrorCode =
    raw && raw.code && raw.code in PHOTO_ERROR_LABELS ? raw.code : 'UNKNOWN';
  return {
    code,
    message: (raw && raw.message) || PHOTO_ERROR_LABELS[code],
    retryable: PHOTO_ERROR_RETRYABLE[code],
    attempts,
    at: Date.now(),
  };
}

function buildMeta(result: AnalyzeResponse): AnalysisMeta {
  const now = Date.now();
  return {
    model: result.meta.model,
    promptVersion: result.meta.promptVersion,
    temperature: result.meta.temperature,
    source: 'vision',
    createdAt: now,
    updatedAt: now,
    usage: result.usage
      ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        }
      : undefined,
    warnings: result.meta.warnings,
  };
}

export async function runBatchAnalysis(options: BatchAnalyzeOptions): Promise<BatchRunSummary> {
  const { photos, concurrency, maxRetries, timeoutMs, style } = options;
  /** 同批已产出标题，用于让模型避开重名 */
  const usedTitles: string[] = [...(style?.existingTitles ?? [])];
  const { onPhotoStart, onPhotoSuccess, onPhotoError, shouldStop } = options;
  const startedAt = Date.now();
  const total = photos.length;

  let cursor = 0;
  let succeeded = 0;
  let failed = 0;

  const processOne = async (photo: Photo): Promise<void> => {
    onPhotoStart(photo.id);

    let attempt = 0;
    let lastError: PhotoError | null = null;

    while (attempt <= maxRetries) {
      attempt += 1;
      try {
        const asset = await AssetRepository.get(photo.id, 'ai');
        if (!asset) {
          lastError = {
            code: 'UPLOAD_FAILED',
            message: '找不到这张照片的识别用图，请重新上传',
            retryable: false,
            attempts: attempt,
            at: Date.now(),
          };
          break;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let result;
        try {
          result = await analyzePhotoLocally(photo.id, asset.blob, asset.mime, controller.signal, {
            titleStyle: style?.titleStyle,
            narrativeStyle: style?.narrativeStyle,
            storyLength: style?.storyLength,
            existingTitles: [...usedTitles],
            pageHint: style?.pageHint,
          });
        } finally {
          clearTimeout(timer);
        }

        if (result.ok) {
          let persisted: Photo | null = null;
          try {
            persisted = await PhotoRepository.update(photo.id, {
              status: 'success',
              analysis: result.analysis,
              meta: buildMeta(result),
              error: undefined,
              isEdited: false,
            });
          } catch (dbError) {
            lastError = {
              code: 'DB_UNAVAILABLE',
              message: '识别成功但写库失败：' + (dbError as Error).message,
              retryable: false,
              attempts: attempt,
              at: Date.now(),
            };
            await PhotoRepository.update(photo.id, {
              status: 'failed',
              error: lastError,
            }).catch(() => undefined);
            onPhotoError(photo.id, lastError, null);
            failed += 1;
            return;
          }
          succeeded += 1;
          if (result.analysis.title) usedTitles.push(result.analysis.title);
          onPhotoSuccess(photo.id, result, persisted);
          return;
        }

        lastError = { ...result.error, attempts: attempt };
        if (!result.error.retryable || attempt > maxRetries) break;
        await sleep(backoff(attempt));
      } catch (error) {
        lastError = toPhotoError(error, attempt);
        if (!lastError.retryable || attempt > maxRetries) break;
        await sleep(backoff(attempt));
      }
    }

    const error: PhotoError =
      lastError ?? {
        code: 'UNKNOWN',
        message: PHOTO_ERROR_LABELS.UNKNOWN,
        retryable: false,
        attempts: attempt,
        at: Date.now(),
      };

    let persisted: Photo | null = null;
    try {
      persisted = await PhotoRepository.update(photo.id, { status: 'failed', error });
    } catch {
      // 状态写不进去也要让 UI 知道失败了
    }
    failed += 1;
    onPhotoError(photo.id, error, persisted);
  };

  const worker = async (): Promise<void> => {
    while (true) {
      if (shouldStop()) return;
      const next = cursor;
      cursor += 1;
      if (next >= total) return;
      const photo = photos[next];
      if (!photo) return;
      await processOne(photo);
    }
  };

  // 0.6.4：并发不能超过 MAX_CONCURRENCY——拉满会占光浏览器对同一域名的 6 个连接，
  // 界面自己要用的请求（客户端导航的 RSC 载荷）就排不上队，表现为「点项目进不去」。
  // 旧设置里存着的 50 也会在这里被压回来。
  const workerCount = Math.max(1, Math.min(concurrency, MAX_CONCURRENCY, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const finishedAt = Date.now();
  const canceled = shouldStop() ? Math.max(0, total - succeeded - failed) : 0;

  return {
    total,
    succeeded,
    failed,
    canceled,
    skipped: 0,
    startedAt,
    finishedAt,
  };
}
