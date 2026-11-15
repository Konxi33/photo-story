// src/lib/ai/schema.ts
// PhotoAnalysis 的结构校验与归一化。浏览器与服务端共用，不 import 任何 Node 内置模块。

import { z } from 'zod';

import type { PhotoAnalysis, PhotoScore, ShootingParams, Technique } from '@/types/domain';

const Text = z.string().trim().catch('');

export const TechniqueSchema = z.object({
  composition: Text,
  lighting: Text,
  color: Text,
  lens: Text,
  post: Text,
});

/** 0.3.1：拍摄参数，旧结果缺失时整体为空字符串 */
export const ShootingParamsSchema = z.object({
  focalLength: Text.default(''),
  aperture: Text.default(''),
  shutter: Text.default(''),
  iso: Text.default(''),
  colorGrade: Text.default(''),
});

/** 0.3.2：评分 */
const ScoreNumber = z.coerce.number().catch(0);

export const ScoreSchema = z.object({
  overall: ScoreNumber,
  breakdown: z.object({
    composition: ScoreNumber,
    lighting: ScoreNumber,
    color: ScoreNumber,
    subject: ScoreNumber,
    timing: ScoreNumber,
    technique: ScoreNumber,
  }),
});

export const PhotoAnalysisSchema = z.object({
  title: Text,
  story: Text,
  technique: TechniqueSchema,
  tags: z.array(z.string()).catch([]),
  mood: Text,
  alt: Text,
  params: ShootingParamsSchema.optional(),
  whyGood: z.array(z.string()).catch([]).optional(),
  improve: z.array(z.string()).catch([]).optional(),
  imitate: z.array(z.string()).catch([]).optional(),
  score: ScoreSchema.optional(),
  scoreAdvice: z.array(z.string()).catch([]).optional(),
});

export type TechniqueParsed = z.infer<typeof TechniqueSchema>;
export type PhotoAnalysisParsed = z.infer<typeof PhotoAnalysisSchema>;

type Assignable<A, B> = [A] extends [B] ? true : false;

export const _assertTechniqueCompat: Assignable<TechniqueParsed, Technique> = true;
export const _assertAnalysisCompat: Assignable<PhotoAnalysisParsed, PhotoAnalysis> = true;

const TITLE_HARD_LIMIT = 20;
const STORY_HARD_LIMIT = 300;
const TAGS_HARD_LIMIT = 6;
const TECHNIQUE_PLACEHOLDER = '（未识别）';
const RAW_EXCERPT_LIMIT = 500;
const BULLET_LIMIT = 3;
const BULLET_CHARS = 40;

const TECHNIQUE_KEYS: (keyof Technique)[] = [
  'composition',
  'lighting',
  'color',
  'lens',
  'post',
];

// 三个反引号，用 fromCharCode 拼出来，避免源码里出现围栏字符
const FENCE = String.fromCharCode(96, 96, 96);

/**
 * 赛事基准校准曲线。
 * 注意：这条曲线只做「轻度校正」，真正的区分度由 score/blend.ts 用像素指标补足。
 * 之前把 90 压到 84、80 压到 72，导致所有照片都挤在 70 分档，已被用户反馈。
 */
const CALIBRATION_KNOTS: [number, number][] = [
  [40, 38],
  [50, 48],
  [60, 59],
  [70, 70],
  [80, 80],
  [90, 89],
  [100, 96],
];

function calibrateScore(raw: number): number {
  const value = Math.min(100, Math.max(0, raw));
  const knots = CALIBRATION_KNOTS;

  if (value <= knots[0]![0]) return knots[0]![1];
  for (let i = 1; i < knots.length; i += 1) {
    const [x1, y1] = knots[i]!;
    if (value <= x1) {
      const [x0, y0] = knots[i - 1]!;
      const ratio = (value - x0) / (x1 - x0);
      return Math.round((y0 + (y1 - y0) * ratio) * 10) / 10;
    }
  }
  return knots[knots.length - 1]![1];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp100 = (n: number): number =>
  Math.min(100, Math.max(0, round1(Number.isFinite(n) ? n : 0)));

/** 小项夹值 → 校准 → 按权重重算总分。整篇生成与单独评分共用。 */
export function normalizePhotoScore(input: PhotoScore): PhotoScore {
  const b = input.breakdown;
  const breakdown = {
    composition: calibrateScore(clamp100(b.composition)),
    lighting: calibrateScore(clamp100(b.lighting)),
    color: calibrateScore(clamp100(b.color)),
    subject: calibrateScore(clamp100(b.subject)),
    timing: calibrateScore(clamp100(b.timing)),
    technique: calibrateScore(clamp100(b.technique)),
  };
  const weighted =
    breakdown.composition * 0.25 +
    breakdown.lighting * 0.2 +
    breakdown.color * 0.15 +
    breakdown.subject * 0.2 +
    breakdown.timing * 0.1 +
    breakdown.technique * 0.1;

  return { overall: clamp100(weighted), breakdown };
}

function normalizeBullets(input: string[] | undefined, warnings: string[], label: string): string[] {
  const out: string[] = [];
  for (const raw of input ?? []) {
    const text = raw.trim();
    if (!text) continue;
    out.push(text.length > BULLET_CHARS ? text.slice(0, BULLET_CHARS) : text);
    if (out.length >= BULLET_LIMIT) break;
  }
  if ((input ?? []).length > BULLET_LIMIT) warnings.push(label + '超过 ' + BULLET_LIMIT + ' 条，已截断');
  return out;
}

export function normalizePhotoAnalysis(input: PhotoAnalysis): {
  data: PhotoAnalysis;
  warnings: string[];
} {
  const warnings: string[] = [];

  let title = input.title.trim();
  if (title.length > TITLE_HARD_LIMIT) {
    title = title.slice(0, TITLE_HARD_LIMIT);
    warnings.push('标题超过 ' + TITLE_HARD_LIMIT + ' 字，已截断');
  }

  let story = input.story.trim();
  if (story.length > STORY_HARD_LIMIT) {
    story = story.slice(0, STORY_HARD_LIMIT);
    warnings.push('故事超过 ' + STORY_HARD_LIMIT + ' 字，已截断');
  }

  const technique = { ...input.technique };
  for (const key of TECHNIQUE_KEYS) {
    const value = technique[key].trim();
    if (!value) {
      technique[key] = TECHNIQUE_PLACEHOLDER;
      warnings.push('拍摄手法「' + key + '」为空，已补占位');
    } else {
      technique[key] = value;
    }
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.tags) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > TAGS_HARD_LIMIT) {
    tags.length = TAGS_HARD_LIMIT;
    warnings.push('标签超过 ' + TAGS_HARD_LIMIT + ' 个，已截断');
  }

  const mood = input.mood.trim();
  if (!mood) warnings.push('氛围为空');

  const alt = input.alt.trim();
  if (!alt) warnings.push('无障碍描述为空');

  const params: ShootingParams | undefined = input.params
    ? {
        focalLength: input.params.focalLength.trim(),
        aperture: input.params.aperture.trim(),
        shutter: input.params.shutter.trim(),
        iso: input.params.iso.trim(),
        colorGrade: input.params.colorGrade.trim(),
      }
    : undefined;

  // 评分：小项夹值 → 赛事校准 → 按权重重算总分
  const score: PhotoScore | undefined = input.score ? normalizePhotoScore(input.score) : undefined;

  const scoreAdvice = normalizeBullets(input.scoreAdvice, warnings, '「评分建议」');

  const data: PhotoAnalysis = {
    title,
    story,
    technique,
    tags,
    mood,
    alt,
    ...(params ? { params } : {}),
    whyGood: normalizeBullets(input.whyGood, warnings, '「为什么好看」'),
    improve: normalizeBullets(input.improve, warnings, '「提升建议」'),
    imitate: normalizeBullets(input.imitate, warnings, '「模仿建议」'),
    ...(score ? { score } : {}),
    ...(scoreAdvice.length > 0 ? { scoreAdvice } : {}),
  };

  return { data, warnings };
}

export type ParsePhotoAnalysisResult =
  | { ok: true; data: PhotoAnalysis; warnings: string[] }
  | {
      ok: false;
      error: { code: 'JSON_PARSE' | 'SCHEMA_INVALID'; message: string; raw: string };
    };

function excerpt(raw: string): string {
  return raw.slice(0, RAW_EXCERPT_LIMIT);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function extractJsonText(raw: string): string | null {
  let text = stripBom(raw).trim();

  const first = text.indexOf(FENCE);
  if (first !== -1) {
    const afterOpen = first + FENCE.length;
    const second = text.indexOf(FENCE, afterOpen);
    text = (second === -1 ? text.slice(afterOpen) : text.slice(afterOpen, second)).trim();
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export function parsePhotoAnalysis(raw: string): ParsePhotoAnalysisResult {
  const jsonText = extractJsonText(raw);
  if (!jsonText) {
    return {
      ok: false,
      error: { code: 'JSON_PARSE', message: '响应里找不到 JSON 对象', raw: excerpt(raw) },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'JSON_PARSE',
        message: (error as Error).message,
        raw: excerpt(raw),
      },
    };
  }

  const result = PhotoAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: 'SCHEMA_INVALID',
        message: result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
        raw: excerpt(raw),
      },
    };
  }

  const normalized = normalizePhotoAnalysis(result.data as PhotoAnalysis);
  return { ok: true, data: normalized.data, warnings: normalized.warnings };
}

/* ------------------------------ 单独评分解析 ------------------------------ */

const ScoreAdviceSchema = z.array(z.string()).catch([]);

const ScoreOnlySchema = z.object({
  score: ScoreSchema,
  scoreAdvice: ScoreAdviceSchema.optional(),
});

export type ParseScoreResult =
  | { ok: true; score: PhotoScore; scoreAdvice: string[] }
  | {
      ok: false;
      error: { code: 'JSON_PARSE' | 'SCHEMA_INVALID'; message: string; raw: string };
    };

/** 解析「只评分」响应：JSON → 校验 → 校准 */
export function parsePhotoScore(raw: string): ParseScoreResult {
  const jsonText = extractJsonText(raw);
  if (!jsonText) {
    return {
      ok: false,
      error: { code: 'JSON_PARSE', message: '响应里找不到 JSON 对象', raw: excerpt(raw) },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      ok: false,
      error: { code: 'JSON_PARSE', message: (error as Error).message, raw: excerpt(raw) },
    };
  }

  const result = ScoreOnlySchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: 'SCHEMA_INVALID',
        message: result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
        raw: excerpt(raw),
      },
    };
  }

  const score = normalizePhotoScore(result.data.score);
  const advice = (result.data.scoreAdvice ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, BULLET_LIMIT)
    .map((item) => (item.length > BULLET_CHARS ? item.slice(0, BULLET_CHARS) : item));

  return { ok: true, score, scoreAdvice: advice };
}
