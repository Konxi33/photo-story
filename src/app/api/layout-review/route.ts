import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';

import { PHOTO_ERROR_LABELS, PHOTO_ERROR_RETRYABLE } from '@/config/app';
import {
  LAYOUT_CHANGE_LIMIT,
  LAYOUT_CHANGE_MAX,
  LAYOUT_GRID_COLS,
  LAYOUT_GRID_ROWS,
  LAYOUT_ISSUE_LIMIT,
  LAYOUT_ISSUE_MAX,
  LAYOUT_JSON_SCHEMA,
  LAYOUT_JSON_SCHEMA_NAME,
  LAYOUT_PROMPT_VERSION,
  LAYOUT_SUMMARY_LIMIT,
  LAYOUT_SYSTEM_PROMPT,
  MAX_LAYOUT_ITEMS,
  blockLabel,
  buildLayoutUserPrompt,
} from '@/config/layoutPrompt';
import { AiServiceError, createClient, readAiConfig, type AiConfigInternal } from '@/lib/ai/server';
import {
  collectLayoutProblems,
  type LayoutGrid,
  type LayoutItem,
  type LayoutReviewInput,
  type LayoutReviewResponse,
  type LayoutSuggestion,
} from '@/lib/ai/layoutReview';
import type {
  AnalyzeUsage,
  PhotoError,
  PhotoErrorCode,
  ResponseFormatMode,
} from '@/types/domain';

/**
 * /api/layout-review —— AI 排版检查。
 *
 * 与 /api/analyze 的分工：那边把图片发给视觉模型写文字/打分，这里**只发文字**
 * （排版 JSON + 样本照片的标题/正文/标签），让模型判「这页摆得对不对」。
 * 返回一份可以直接应用的完整排版，服务端负责复核它是否合法（越界/重叠/id 对不上都退回 null）。
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const MODEL_TIMEOUT_MS = 60000;

/** 排版评审要读一整页的版面关系，思考模式给足空间；DeepSeek 以外不发送这些字段 */
function thinkingParams(config: AiConfigInternal): Record<string, unknown> {
  const isDeepSeek =
    config.provider === 'deepseek' || config.baseURL.includes('api.deepseek.com');
  if (!isDeepSeek) return {};

  if (config.reasoning === 'off') {
    return { thinking: { type: 'disabled' } };
  }
  return {
    thinking: { type: 'enabled' },
    reasoning_effort: config.reasoning === 'high' ? 'high' : 'low',
  };
}

function buildResponseFormat(
  mode: ResponseFormatMode,
  schema: Record<string, unknown>,
  schemaName: string,
): Record<string, unknown> | undefined {
  if (mode === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    };
  }
  if (mode === 'json_object') return { type: 'json_object' };
  return undefined;
}

/** 与 src/lib/ai/server/provider.ts 同一套错误口径，UI 才能复用已有的提示文案 */
function toServiceError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) return error;

  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    if (status === 401 || status === 403) {
      return new AiServiceError('AI_AUTH', 'API Key 无效或已过期，请到设置中检查', status, error);
    }
    if (status === 429) {
      return new AiServiceError('AI_RATE_LIMIT', '请求过于频繁，稍后会自动重试', status, error);
    }
    if (status === 408 || status === 504) {
      return new AiServiceError('AI_TIMEOUT', '检查超时，可重试一次', status, error);
    }
    return new AiServiceError(
      'AI_HTTP',
      '模型服务返回错误（' + (status || '未知') + '）',
      status,
      error,
    );
  }

  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new AiServiceError('AI_TIMEOUT', '检查超时，可重试一次', 504, error);
  }

  return new AiServiceError('AI_HTTP', '调用模型服务失败', 502, error);
}

interface LayoutModelResult {
  raw: string;
  model: string;
  temperature: number;
  latencyMs: number;
  responseFormat: ResponseFormatMode;
  usage?: AnalyzeUsage;
}

/**
 * 调模型。降级链与 provider.ts 一致：json_schema → json_object → text，
 * 每级遇到 400（服务商不认识该参数）就往下退；开思考时如果 content 为空，
 * 关掉思考再试一次（DeepSeek 的思考 token 会吃掉正文）。
 */
async function askModel(
  config: AiConfigInternal,
  userPrompt: string,
): Promise<LayoutModelResult> {
  const client = createClient(config);
  const modes: ResponseFormatMode[] = ['json_schema', 'json_object', 'text'];
  const startedAt = Date.now();

  let lastError: unknown = null;

  for (const mode of modes) {
    try {
      let thinkingEnabled = config.reasoning !== 'off';
      let completion: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const effectiveConfig = thinkingEnabled
          ? config
          : { ...config, reasoning: 'off' as const };

        completion = await client.chat.completions.create(
          {
            model: config.model,
            temperature: config.temperature,
            max_tokens: thinkingEnabled ? Math.max(config.maxTokens, 4096) : config.maxTokens,
            messages: [
              { role: 'system', content: LAYOUT_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            response_format: buildResponseFormat(
              mode,
              LAYOUT_JSON_SCHEMA as unknown as Record<string, unknown>,
              LAYOUT_JSON_SCHEMA_NAME,
            ) as never,
            ...thinkingParams(effectiveConfig),
          },
          { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) },
        );

        const text = completion.choices[0]?.message?.content ?? '';
        if (text.trim()) break;

        if (thinkingEnabled) {
          thinkingEnabled = false;
          continue;
        }
        throw new AiServiceError('AI_HTTP', '模型返回了空内容', 502);
      }

      const raw = completion?.choices[0]?.message?.content ?? '';
      if (!raw.trim()) throw new AiServiceError('AI_HTTP', '模型返回了空内容', 502);

      return {
        raw,
        model: completion?.model || config.model,
        temperature: config.temperature,
        latencyMs: Date.now() - startedAt,
        responseFormat: mode,
        usage: {
          promptTokens: completion?.usage?.prompt_tokens,
          completionTokens: completion?.usage?.completion_tokens,
          totalTokens: completion?.usage?.total_tokens,
        },
      };
    } catch (error) {
      lastError = error;
      // 只有「服务商不支持该 response_format」才降级，其余错误直接抛
      if (mode !== 'text' && error instanceof OpenAI.APIError && error.status === 400) continue;
      throw toServiceError(error);
    }
  }

  throw toServiceError(lastError);
}

/* ------------------------------ 请求体校验 ------------------------------ */

/** 数字一律取整：格子坐标不允许出现 0.5 这种值 */
const Cell = z.number().finite().transform((value) => Math.round(value));

const LayoutItemSchema = z
  .object({
    id: z.string().trim().min(1).max(24),
    col: Cell,
    row: Cell,
    colSpan: Cell,
    rowSpan: Cell,
  })
  .strict();

const LayoutRequestSchema = z
  .object({
    layout: z
      .object({
        cols: z.number().int().min(1).max(64),
        rows: z.number().int().min(1).max(64),
        items: z.array(LayoutItemSchema).max(MAX_LAYOUT_ITEMS),
      })
      .strict(),
    /** 这一页用到的样本照片：只传文字，不传图片 */
    sample: z
      .object({
        title: z.string().trim().max(60).optional(),
        story: z.string().max(4000).optional(),
        tags: z.array(z.string().trim().max(20)).max(20).optional(),
        hasScore: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** 版心宽高，cm（保留一位小数，别把 16.6 取整成 17） */
    contentCm: z.number().finite().min(4).max(60).transform((v) => Math.round(v * 10) / 10),
    contentHeightCm: z.number().finite().min(4).max(80).transform((v) => Math.round(v * 10) / 10),
  })
  .strict();

/* ----------------------------- 返回值整理 ----------------------------- */

const TextList = z.array(z.union([z.string(), z.number(), z.null()])).catch([]);

const ModelSuggestionSchema = z.object({
  summary: z.union([z.string(), z.number(), z.null()]).catch(''),
  issues: TextList,
  layout: z.unknown().catch(null),
  changes: TextList,
});

function clampText(value: unknown, limit: number): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? clean.slice(0, limit - 1) + '…' : clean;
}

/** 从模型输出里抠出 JSON：优先整段解析，其次从第一个 { 到最后一个 } */
function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const candidates = [unfenced];
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(unfenced.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // 换下一种切法继续试
    }
  }
  return null;
}

/** 把模型给的 layout 拍成整数格子；越界/重叠交给 collectLayoutProblems 判 */
function coerceLayout(value: unknown): LayoutGrid {
  const raw = (value ?? {}) as { cols?: unknown; rows?: unknown; items?: unknown };
  const items = Array.isArray(raw.items) ? raw.items : [];

  return {
    cols: Math.round(Number(raw.cols ?? LAYOUT_GRID_COLS)),
    rows: Math.round(Number(raw.rows ?? LAYOUT_GRID_ROWS)),
    items: items.map((entry) => {
      const item = (entry ?? {}) as Partial<Record<keyof LayoutItem, unknown>>;
      return {
        id: typeof item.id === 'string' ? item.id.trim() : '',
        col: Math.round(Number(item.col ?? Number.NaN)),
        row: Math.round(Number(item.row ?? Number.NaN)),
        colSpan: Math.round(Number(item.colSpan ?? Number.NaN)),
        rowSpan: Math.round(Number(item.rowSpan ?? Number.NaN)),
      };
    }),
  };
}

/** 积木清单必须原样保留：少一块就是丢内容，多一块是凭空造块 */
function sameItemIds(before: LayoutGrid, after: LayoutGrid): boolean {
  const target = new Set(before.items.map((item) => item.id));
  const got = new Set(after.items.map((item) => item.id));
  if (target.size !== got.size) return false;
  for (const id of target) {
    if (!got.has(id)) return false;
  }
  return true;
}

/** 模型没说改了什么时的兜底：按两份排版的差异自己写一句，免得 UI 出现「改了但没说」 */
function describeLayoutDiff(before: LayoutGrid, after: LayoutGrid): string[] {
  const previous = new Map(before.items.map((item) => [item.id, item]));
  const lines: string[] = [];

  for (const item of after.items) {
    const old = previous.get(item.id);
    if (!old) continue;
    const moved = old.col !== item.col || old.row !== item.row;
    const resized = old.colSpan !== item.colSpan || old.rowSpan !== item.rowSpan;
    if (!moved && !resized) continue;

    const name = blockLabel(item.id);
    if (moved && resized) {
      lines.push(
        name +
          '挪到第 ' +
          item.col +
          ' 列第 ' +
          item.row +
          ' 行，改为 ' +
          item.colSpan +
          ' 列 × ' +
          item.rowSpan +
          ' 行',
      );
    } else if (moved) {
      lines.push(name + '挪到第 ' + item.col + ' 列第 ' + item.row + ' 行');
    } else {
      lines.push(name + '改为 ' + item.colSpan + ' 列 × ' + item.rowSpan + ' 行');
    }
    if (lines.length >= LAYOUT_CHANGE_MAX) break;
  }

  return lines;
}

interface BuiltSuggestion {
  suggestion: LayoutSuggestion;
  warnings: string[];
}

/**
 * 整理模型返回：截断超长文案、复核 layout 合法性、补上缺失的改动说明。
 * 这里是「服务端必须自己校验」那条硬要求的落点 —— 模型给的排版只要有一条不合法，
 * 就整块丢掉（layout: null），并把原因写进 issues，绝不把坏数据交给 UI 去应用。
 */
function buildSuggestion(
  parsed: z.infer<typeof ModelSuggestionSchema>,
  original: LayoutGrid,
): BuiltSuggestion {
  const warnings: string[] = [];

  const summary = clampText(parsed.summary, LAYOUT_SUMMARY_LIMIT) || '这页排版没有发现明显问题';
  const issues = parsed.issues
    .map((item) => clampText(item, LAYOUT_ISSUE_LIMIT))
    .filter((item) => item.length > 0);

  let layout: LayoutGrid | null = null;

  if (parsed.layout != null) {
    const candidate = coerceLayout(parsed.layout);
    const problems = collectLayoutProblems(candidate);

    if (problems.length > 0) {
      warnings.push(...problems);
      for (const problem of problems.slice(0, LAYOUT_ISSUE_MAX)) {
        issues.unshift(clampText('模型给的排版不能用：' + problem, LAYOUT_ISSUE_LIMIT));
      }
    } else if (!sameItemIds(original, candidate)) {
      warnings.push('模型返回的积木 id 与输入不一致');
      issues.unshift('模型改动了积木清单，排版已忽略');
    } else if (JSON.stringify(candidate) === JSON.stringify(original)) {
      warnings.push('模型返回的排版与原来相同，按「没有改动」处理');
    } else {
      layout = candidate;
    }
  }

  const changes = parsed.changes
    .map((item) => clampText(item, LAYOUT_CHANGE_LIMIT))
    .filter((item) => item.length > 0)
    .slice(0, LAYOUT_CHANGE_MAX);

  const suggestion: LayoutSuggestion = {
    summary,
    issues: issues.slice(0, LAYOUT_ISSUE_MAX),
    layout,
    changes: changes.length > 0 ? changes : layout ? describeLayoutDiff(original, layout) : [],
  };

  return { suggestion, warnings };
}

function fail(
  code: PhotoErrorCode,
  message: string,
  httpStatus: number,
  raw?: string,
): NextResponse {
  const body: { ok: false; error: PhotoError } = {
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail('SCHEMA_INVALID', '请求体不是合法 JSON', 400);
  }

  const parsed = LayoutRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first
      ? (first.path.join('.') || '(root)') + '：' + first.message
      : '参数不合法';
    return fail('SCHEMA_INVALID', detail, 400);
  }

  const input: LayoutReviewInput = parsed.data;

  // 送进来的排版本身就不合法（重叠/越界）时，先让调用方去修，不必花一次模型调用
  const inputProblems = collectLayoutProblems(input.layout);
  if (inputProblems.length > 0) {
    return fail('SCHEMA_INVALID', '当前排版不合法：' + inputProblems[0], 400);
  }

  try {
    const config = await readAiConfig();
    const result = await askModel(config, buildLayoutUserPrompt(input));

    const json = extractJson(result.raw);
    if (json === null) {
      return fail('JSON_PARSE', PHOTO_ERROR_LABELS.JSON_PARSE, 422, result.raw.slice(0, 500));
    }

    const suggestionParsed = ModelSuggestionSchema.safeParse(json);
    if (!suggestionParsed.success) {
      return fail('SCHEMA_INVALID', PHOTO_ERROR_LABELS.SCHEMA_INVALID, 422, result.raw.slice(0, 500));
    }

    const { suggestion, warnings } = buildSuggestion(suggestionParsed.data, input.layout);

    const body: LayoutReviewResponse = {
      ok: true,
      suggestion,
      meta: {
        model: result.model,
        promptVersion: LAYOUT_PROMPT_VERSION,
        temperature: result.temperature,
        latencyMs: result.latencyMs,
        responseFormat: result.responseFormat,
        warnings,
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
