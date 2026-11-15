import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { PHOTO_ERROR_LABELS, PHOTO_ERROR_RETRYABLE } from '@/config/app';
import { PROMPT_VERSION } from '@/config/prompts';
import { SCORE_PROMPT_VERSION } from '@/config/scorePrompt';
import { AiServiceError, analyzeImage, readAiConfig } from '@/lib/ai/server';
import { parsePhotoAnalysis, parsePhotoScore } from '@/lib/ai/schema';
import type { AnalyzeErrorResponse, AnalyzeResponse, PhotoErrorCode } from '@/types/domain';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const AnalyzeRequestSchema = z
  .object({
    photoId: z.string().min(1),
    imageBase64: z.string().min(1).optional(),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
    userDescription: z.string().min(5).max(2000).optional(),
    promptVersion: z.string().max(20).optional(),
    mode: z.enum(['full', 'score']).optional(),
    /** 评审室：三评委身份，只对 mode='score' 生效 */
    judge: z.enum(['editor', 'curator', 'tech']).optional(),
    style: z
      .object({
        titleStyle: z
          .enum(['literary', 'concise', 'poetic', 'cinematic', 'plain', 'symbol'])
          .optional(),
        narrativeStyle: z
          .enum(['essay', 'documentary', 'prose-poem', 'diary', 'terse'])
          .optional(),
        storyLength: z.enum(['short', 'medium', 'long']).optional(),
        existingTitles: z.array(z.string().max(40)).max(200).optional(),
      })
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.imageBase64) || Boolean(v.userDescription), {
    message: 'imageBase64 与 userDescription 至少提供一个',
    path: ['imageBase64'],
  })
  .refine((v) => !v.imageBase64 || Boolean(v.mimeType), {
    message: '提供图片时必须同时提供 mimeType',
    path: ['mimeType'],
  });

function fail(code: PhotoErrorCode, message: string, httpStatus: number, raw?: string) {
  const body: AnalyzeErrorResponse = {
    ok: false,
    error: {
      code,
      message,
      retryable: PHOTO_ERROR_RETRYABLE[code],
      attempts: 1,
      at: Date.now(),
      raw,
    },
  };
  return NextResponse.json(body, { status: httpStatus, headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail('SCHEMA_INVALID', '请求体不是合法 JSON', 400);
  }

  const parsed = AnalyzeRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first
      ? (first.path.join('.') || '(root)') + '：' + first.message
      : '参数不合法';
    return fail('SCHEMA_INVALID', detail, 400);
  }

  const req = parsed.data;

  try {
    const config = await readAiConfig();

    // 只评分模式：不重写标题/故事，返回 score + scoreAdvice
    if (req.mode === 'score') {
      const result = await analyzeImage({
        config,
        imageBase64: req.imageBase64,
        mimeType: req.mimeType,
        mode: 'score',
        judge: req.judge,
      });

      const scored = parsePhotoScore(result.raw);
      if (!scored.ok) {
        return fail(scored.error.code, scored.error.message, 422, scored.error.raw);
      }

      return NextResponse.json(
        {
          ok: true,
          score: scored.score,
          scoreAdvice: scored.scoreAdvice,
          meta: {
            model: result.model,
            promptVersion: SCORE_PROMPT_VERSION,
            temperature: result.temperature,
            latencyMs: result.latencyMs,
            responseFormat: result.responseFormat,
            warnings: [],
          },
          usage: result.usage,
        },
        { headers: NO_STORE },
      );
    }

    const result = await analyzeImage({
      config,
      imageBase64: req.imageBase64,
      mimeType: req.mimeType,
      userDescription: req.userDescription,
      style: req.style,
    });

    const outcome = parsePhotoAnalysis(result.raw);
    if (!outcome.ok) {
      return fail(outcome.error.code, outcome.error.message, 422, outcome.error.raw);
    }

    const body: AnalyzeResponse = {
      ok: true,
      analysis: outcome.data,
      meta: {
        model: result.model,
        promptVersion: PROMPT_VERSION,
        temperature: result.temperature,
        latencyMs: result.latencyMs,
        responseFormat: result.responseFormat,
        warnings: outcome.warnings,
      },
      usage: result.usage,
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AiServiceError) {
      return fail(error.code, error.message, error.code === 'CONFIG_MISSING' ? 400 : 502);
    }
    return fail('UNKNOWN', PHOTO_ERROR_LABELS.UNKNOWN, 500);
  }
}
