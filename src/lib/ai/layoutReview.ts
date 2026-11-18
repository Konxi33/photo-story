// src/lib/ai/layoutReview.ts
// 0.6.x：AI 排版检查的浏览器端调用层 + 排版合法性校验。
//
// 这个文件会被画布组件（src/app/studio/page.tsx）直接 import，所以：
//   · 不 import 任何 server-only / Node 内置模块（只读配置常量与类型）；
//   · reviewLayout 永不抛异常，统一返回 { ok, ... }（与 src/lib/ai/client.ts 同一约定）。
// validateLayout 是纯函数，服务端路由也用它复核模型返回的排版 —— 一套规则，两边共用。

import { PHOTO_ERROR_LABELS, PHOTO_ERROR_RETRYABLE } from '@/config/app';
import {
  LAYOUT_GRID_COLS,
  LAYOUT_GRID_ROWS,
  MAX_LAYOUT_ITEMS,
} from '@/config/layoutPrompt';
import type { AnalyzeUsage, PhotoError, PhotoErrorCode, ResponseFormatMode } from '@/types/domain';

/**
 * 路由地址。写在这里而不是 src/config/app.ts 的 API_ROUTES 里，
 * 是为了不碰那份正在被并行修改的文件；风格保持一致，方便以后并回 API_ROUTES。
 */
const LAYOUT_REVIEW_ENDPOINT = '/api/layout-review' as const;

/* --------------------------------- 类型 --------------------------------- */

/** 一块积木：左上角格子 (col, row) + 占几列几行 */
export interface LayoutItem {
  id: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

/** 一页：12 列 × 24 行的网格 */
export interface LayoutGrid {
  cols: number;
  rows: number;
  items: LayoutItem[];
}

/** 这一页用到的样本照片 —— 只传文字，不传图片 */
export interface LayoutSampleInfo {
  title?: string;
  story?: string;
  tags?: string[];
  hasScore?: boolean;
}

/** reviewLayout 的入参 */
export interface LayoutReviewInput {
  layout: LayoutGrid;
  sample?: LayoutSampleInfo;
  /** 版心宽高，cm */
  contentCm: number;
  contentHeightCm: number;
}

/** 模型给出的建议（也是服务端 /api/layout-review 返回体里的 suggestion） */
export interface LayoutSuggestion {
  /** 一句总评，≤40 字 */
  summary: string;
  /** 发现的问题，0~5 条，每条 ≤30 字 */
  issues: string[];
  /** 修正后的完整排版（合法的 12×24 网格，条目不重叠）；没有建议改动时为 null */
  layout: LayoutGrid | null;
  /** 改动的自然语言说明，1~3 条 */
  changes: string[];
}

/** 与 AnalyzeResponseMeta 同形，便于 UI 复用同一套统计展示 */
export interface LayoutReviewMeta {
  model: string;
  promptVersion: string;
  temperature: number;
  latencyMs: number;
  responseFormat: ResponseFormatMode;
  warnings: string[];
}

/**
 * 路由的原始返回：suggestion 是**嵌套**的。
 * 服务端把建议当一整块复核（合法才认），客户端再摊平给 UI 用。
 */
export interface LayoutReviewResponse {
  ok: true;
  suggestion: LayoutSuggestion;
  meta: LayoutReviewMeta;
  usage?: AnalyzeUsage;
}

export interface LayoutReviewErrorResponse {
  ok: false;
  error: PhotoError;
}

export type LayoutReviewWireResult = LayoutReviewResponse | LayoutReviewErrorResponse;

/** reviewLayout 的结果就是路由的原始返回：UI 用 result.suggestion / result.error.message */
export type LayoutReviewResult = LayoutReviewResponse | LayoutReviewErrorResponse;

/* ------------------------------ 合法性校验 ------------------------------ */

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** 两块积木是否互相压住（与 src/lib/export/layout.ts 的 overlaps 同一判定） */
export function itemsOverlap(a: LayoutItem, b: LayoutItem): boolean {
  return (
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  );
}

/**
 * 把一份排版的所有问题列出来（空数组 = 合法）。
 * 规则：网格必须是 12×24、每项 4 个数字都是整数、尺寸 ≥1、
 * 0 ≤ col 且 col + colSpan ≤ 12、0 ≤ row 且 row + rowSpan ≤ 24、
 * id 不重复、任意两项不重叠、积木不超过 20 块。
 */
export function collectLayoutProblems(layout: unknown): string[] {
  const problems: string[] = [];

  if (!layout || typeof layout !== 'object') return ['排版不是对象'];
  const grid = layout as Partial<LayoutGrid>;

  if (grid.cols !== LAYOUT_GRID_COLS || grid.rows !== LAYOUT_GRID_ROWS) {
    problems.push('网格必须是 ' + LAYOUT_GRID_COLS + ' 列 × ' + LAYOUT_GRID_ROWS + ' 行');
  }
  if (!Array.isArray(grid.items)) return [...problems, 'items 不是数组'];
  if (grid.items.length === 0) problems.push('一页至少要有 1 块积木');
  if (grid.items.length > MAX_LAYOUT_ITEMS) {
    problems.push('积木超过 ' + MAX_LAYOUT_ITEMS + ' 块');
  }

  const seen = new Set<string>();
  const rects: LayoutItem[] = [];

  grid.items.forEach((raw, index) => {
    const item = raw as Partial<LayoutItem> | null | undefined;
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const label = id ? id : '第 ' + (index + 1) + ' 块';

    if (!id) {
      problems.push(label + ' 缺少 id');
    } else if (seen.has(id)) {
      problems.push(label + ' 重复出现');
    } else {
      seen.add(id);
    }

    if (!isInt(item?.col) || !isInt(item?.row) || !isInt(item?.colSpan) || !isInt(item?.rowSpan)) {
      problems.push(label + ' 的格子坐标与尺寸必须是整数');
      return;
    }
    if (item.colSpan < 1 || item.rowSpan < 1) {
      problems.push(label + ' 尺寸非法');
      return;
    }
    if (item.col < 0 || item.row < 0) problems.push(label + ' 坐标不能为负');
    if (item.col + item.colSpan > LAYOUT_GRID_COLS) problems.push(label + ' 超出右边界');
    if (item.row + item.rowSpan > LAYOUT_GRID_ROWS) problems.push(label + ' 超出下边界');

    rects.push({
      id: label,
      col: item.col,
      row: item.row,
      colSpan: item.colSpan,
      rowSpan: item.rowSpan,
    });
  });

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (itemsOverlap(rects[i], rects[j])) {
        problems.push(rects[i].id + ' 与 ' + rects[j].id + ' 互相压住');
      }
    }
  }

  return problems;
}

/**
 * 这份排版能不能直接用：true = 合法。
 * 服务端拿到模型返回的 layout 后必须过这一关，UI 应用前也过一遍。
 */
export function validateLayout(layout: unknown): boolean {
  return collectLayoutProblems(layout).length === 0;
}

/* ------------------------------- 调用路由 ------------------------------- */

/** 本地就能判定的失败，也拼成和路由一致的 PhotoError，UI 只需要认一种形状 */
function failure(code: PhotoErrorCode, message?: string): LayoutReviewErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message: message && message.trim() ? message.trim() : PHOTO_ERROR_LABELS[code],
      retryable: PHOTO_ERROR_RETRYABLE[code],
      attempts: 1,
      at: Date.now(),
    },
  };
}

/** 路由自己给的 PhotoError 一般可以直接用，缺字段时按错误码补默认值 */
function toFailure(error: PhotoError | undefined): LayoutReviewErrorResponse {
  const code: PhotoErrorCode = error?.code ?? 'AI_HTTP';
  return {
    ok: false,
    error: {
      code,
      message: error?.message || PHOTO_ERROR_LABELS[code],
      retryable: error?.retryable ?? PHOTO_ERROR_RETRYABLE[code],
      attempts: error?.attempts ?? 1,
      at: error?.at ?? Date.now(),
      raw: error?.raw,
    },
  };
}

/** 模型给的排版万一不合法：整块丢掉，但把原因留在 issues 里，不要静默吞掉 */
function sanitizeSuggestion(
  suggestion: LayoutSuggestion,
  original: LayoutGrid,
): LayoutSuggestion {
  const next: LayoutSuggestion = {
    summary: typeof suggestion.summary === 'string' ? suggestion.summary : '',
    issues: Array.isArray(suggestion.issues)
      ? suggestion.issues.filter((item) => typeof item === 'string')
      : [],
    layout: suggestion.layout ?? null,
    changes: Array.isArray(suggestion.changes)
      ? suggestion.changes.filter((item) => typeof item === 'string')
      : [],
  };

  if (next.layout && !validateLayout(next.layout)) {
    const reason = collectLayoutProblems(next.layout)[0] ?? '结构不合法';
    next.layout = null;
    next.issues = [...next.issues, '模型给的排版不能用（' + reason + '）'];
  }
  // 布局没变就等于没建议，避免 UI 让用户「确认一个空改动」
  if (next.layout && JSON.stringify(next.layout) === JSON.stringify(original)) {
    next.layout = null;
  }
  return next;
}

/**
 * 让模型检查这一页的排版。
 * 先本地校验一遍（摆错了就不必花一次模型调用），再 POST /api/layout-review。
 */
export async function reviewLayout(
  input: LayoutReviewInput,
  signal?: AbortSignal,
): Promise<LayoutReviewResult> {
  const problems = collectLayoutProblems(input.layout);
  if (problems.length > 0) {
    return failure('SCHEMA_INVALID', '当前排版不合法：' + problems[0]);
  }

  let response: Response;
  try {
    response = await fetch(LAYOUT_REVIEW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return failure('AI_TIMEOUT', PHOTO_ERROR_LABELS.AI_TIMEOUT);
    }
    return failure('NETWORK', PHOTO_ERROR_LABELS.NETWORK);
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as LayoutReviewWireResult;
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
      if (!parsed.ok) return toFailure(parsed.error);
      return {
        ok: true,
        suggestion: sanitizeSuggestion(parsed.suggestion, input.layout),
        meta: parsed.meta,
        usage: parsed.usage,
      };
    }
    return failure('AI_HTTP', '返回内容格式不正确（' + response.status + '）');
  } catch {
    return failure(
      'AI_HTTP',
      response.ok ? '返回内容不是有效 JSON' : '请求失败（' + response.status + '）',
    );
  }
}
