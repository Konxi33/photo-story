// src/lib/ai/client.ts
// 浏览器端调用层：把 Blob 转 base64 后 POST /api/analyze，永不抛异常。

import { API_ROUTES, PHOTO_ERROR_LABELS } from '@/config/app';
import type { JudgeId } from '@/config/scorePrompt';
import { refineScore } from '@/lib/score/blend';
import type {
  AnalyzeResult,
  AnalyzeStyleOptions,
  PhotoError,
  PhotoErrorCode,
  ScoreResult,
} from '@/types/domain';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('读取图片失败'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function makeError(code: PhotoErrorCode, message: string, retryable: boolean): PhotoError {
  return { code, message, retryable, attempts: 1, at: Date.now() };
}

export async function analyzePhotoLocally(
  photoId: string,
  imageBlob: Blob,
  mimeType: string,
  signal?: AbortSignal,
  style?: AnalyzeStyleOptions,
): Promise<AnalyzeResult> {
  let imageBase64: string;
  try {
    imageBase64 = await blobToBase64(imageBlob);
  } catch {
    return {
      ok: false,
      error: makeError('UPLOAD_FAILED', '读取本地图片失败，请重试', false),
    };
  }

  const result = await postAnalyze({ photoId, imageBase64, mimeType, style }, signal);

  // 整篇生成也带评分时，用同一套像素指标做混合，保证两种入口分数口径一致
  if (result.ok && result.analysis.score) {
    const refined = await refineScore(result.analysis.score, imageBlob);
    return { ...result, analysis: { ...result.analysis, score: refined.score } };
  }
  return result;
}

/**
 * 无视觉能力时的兜底：把用户粘贴的画面描述发给服务端，
 * 由纯文本模型（如 deepseek-chat）整理成结构化结果。
 */
export async function analyzePhotoWithDescription(
  photoId: string,
  description: string,
  signal?: AbortSignal,
  style?: AnalyzeStyleOptions,
): Promise<AnalyzeResult> {
  return postAnalyze({ photoId, userDescription: description, style }, signal);
}

/* ------------------------------ 单独评分 ------------------------------ */

export async function scorePhotoLocally(
  photoId: string,
  imageBlob: Blob,
  mimeType: string,
  signal?: AbortSignal,
): Promise<ScoreResult> {
  let imageBase64: string;
  try {
    imageBase64 = await blobToBase64(imageBlob);
  } catch {
    return { ok: false, error: makeError('UPLOAD_FAILED', '读取本地图片失败，请重试', false) };
  }

  let response: Response;
  try {
    response = await fetch(API_ROUTES.analyze, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId, imageBase64, mimeType, mode: 'score' }),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: makeError('AI_TIMEOUT', PHOTO_ERROR_LABELS.AI_TIMEOUT, true) };
    }
    return { ok: false, error: makeError('NETWORK', PHOTO_ERROR_LABELS.NETWORK, true) };
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as ScoreResult;
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
      if (parsed.ok) {
        // 与像素指标混合，避免模型把所有照片打成一个分数
        const refined = await refineScore(parsed.score, imageBlob);
        return { ...parsed, score: refined.score };
      }
      return parsed;
    }
    return {
      ok: false,
      error: makeError('AI_HTTP', '返回内容格式不正确（' + response.status + '）', true),
    };
  } catch {
    return {
      ok: false,
      error: makeError(
        'AI_HTTP',
        response.ok ? '返回内容不是有效 JSON' : '请求失败（' + response.status + '）',
        response.status >= 500 || response.status === 429,
      ),
    };
  }
}

/**
 * 评审室：指定评委身份给一张照片打分。
 * 与 scorePhotoLocally 的区别是**不做像素混合**——这里要的就是模型的主观判断，
 * 三位评委的分数差本身就是产品价值（分歧大的片子才是值得再看一遍的片子）。
 */
export async function judgePhotoLocally(
  photoId: string,
  imageBlob: Blob,
  mimeType: string,
  judge: JudgeId,
  signal?: AbortSignal,
): Promise<ScoreResult> {
  let imageBase64: string;
  try {
    imageBase64 = await blobToBase64(imageBlob);
  } catch {
    return { ok: false, error: makeError('UPLOAD_FAILED', '读取本地图片失败，请重试', false) };
  }

  let response: Response;
  try {
    response = await fetch(API_ROUTES.analyze, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId, imageBase64, mimeType, mode: 'score', judge }),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: makeError('AI_TIMEOUT', PHOTO_ERROR_LABELS.AI_TIMEOUT, true) };
    }
    return { ok: false, error: makeError('NETWORK', PHOTO_ERROR_LABELS.NETWORK, true) };
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as ScoreResult;
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    return {
      ok: false,
      error: makeError('AI_HTTP', '返回内容格式不正确（' + response.status + '）', true),
    };
  } catch {
    return {
      ok: false,
      error: makeError(
        'AI_HTTP',
        response.ok ? '返回内容不是有效 JSON' : '请求失败（' + response.status + '）',
        response.status >= 500 || response.status === 429,
      ),
    };
  }
}

async function postAnalyze(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AnalyzeResult> {
  let response: Response;
  try {
    response = await fetch(API_ROUTES.analyze, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: makeError('AI_TIMEOUT', PHOTO_ERROR_LABELS.AI_TIMEOUT, true) };
    }
    return { ok: false, error: makeError('NETWORK', PHOTO_ERROR_LABELS.NETWORK, true) };
  }

  const text = await response.text();

  try {
    const parsed = JSON.parse(text) as AnalyzeResult;
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    return {
      ok: false,
      error: makeError('AI_HTTP', '返回内容格式不正确（' + response.status + '）', true),
    };
  } catch {
    return {
      ok: false,
      error: makeError(
        'AI_HTTP',
        response.ok ? '返回内容不是有效 JSON' : '请求失败（' + response.status + '）',
        response.status >= 500 || response.status === 429,
      ),
    };
  }
}
