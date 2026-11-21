// src/lib/export/text-measure.ts
// 0.6.5：PDF 用的「真·文字测量」。
//
// 0.6.4 及之前，两套引擎都拿 layout.ts 的 measureTextCm 估算行数：
// 它把中文当 1em、西文当 0.55em 一律折算，遇到长英文单词、窄栏、长标题就会
// 少估一行 —— 少估的这一行会被 CSS 的 overflow:hidden / -webkit-line-clamp
// 直接裁掉，用户看到的「文字被截断、下面看不到了」就是它。
//
// 这一版改成用浏览器原生 canvas 的 measureText 按真实字体栈/字号/字距测量，
// 再用和中英混排一致的断行规则（逐字断 + 避头尾）算出每一行：
//   · 字体全是本机系统字体、没有 @font-face，canvas 与打印用的是同一套字形；
//   · 行数算准了，高度预算才准，容器的固定高度才敢写死；
//   · 装不下时按「整句」丢尾（必要时才补「…」），绝不出现半个字/半行。
//
// 画布在 Node/SSR 里不存在（tsx 脚本、服务端预渲染），这时退回字宽表估算，
// 保证不抛异常；只有浏览器里出 PDF，精度问题不影响正确性。
'use client';

import { NO_END, canBreakAfterAt, isWideChar, splitSentences } from './kinsoku';

/** pt → mm */
export const PT_TO_MM = 25.4 / 72;
/** 1mm 合多少 CSS px（96dpi） */
const PX_PER_MM = 96 / 25.4;

/**
 * 每行让出的安全宽度（mm）。
 * canvas 的 advance width 与布局引擎的断行结果在极少数情况下会差半个字
 * （字偶距、标点挤压），留一点余量让我们「宁可少排一个字」，也绝不撑爆。
 */
export const WRAP_SAFE_MM = 0.4;

export interface FontSpec {
  /** 字号（pt） */
  sizePt: number;
  /** 行高（pt）—— 必须与 CSS line-height 换算出来的高度完全一致 */
  linePt: number;
  /** CSS font-family 值（完整字体栈） */
  family: string;
  /** 字重，默认 400 */
  weight?: number | string;
  /** 字距（em），对应 CSS letter-spacing，默认 0 */
  trackingEm?: number;
}

export interface WrapOptions {
  /** 首行缩进（em），对应 CSS text-indent */
  firstIndentEm?: number;
  /** 覆盖默认安全余量（mm） */
  safeMm?: number;
}

export interface WrapResult {
  lines: string[];
  /** 每行在「规范化后的文本」里的结束下标（exclusive），截断时按它切 */
  ends: number[];
}

export interface FitResult {
  /** 最终排进框里的文本（未截断时就是规范化后的原文） */
  text: string;
  lines: number;
  /** 文本高度（mm）= 行数 × 行高 */
  heightMm: number;
  /** 是否被缩短（末尾补了省略号） */
  truncated: boolean;
  /** 为消除孤行而微调的字距（em，负数=收紧）；渲染时要写进 style */
  trackingEm: number;
}

/** 造一个 FontSpec（省得调用方到处拼对象） */
export function makeFont(
  family: string,
  sizePt: number,
  linePt: number,
  weight: number | string = 400,
  trackingEm = 0,
): FontSpec {
  return { sizePt, linePt, family, weight, trackingEm };
}

/** 行高（mm） */
export function lineHeightMm(font: FontSpec): number {
  return font.linePt * PT_TO_MM;
}

/** 规范化空白：与 CSS 的空白折叠保持同一口径（连续空白 → 一个空格） */
export function normalizeText(text: string): string {
  return text.replace(/[ \t\r\n\u3000]+/g, ' ').trim();
}

/* ----------------------------- 测量后端 ----------------------------- */

interface Measurer {
  /** 一段文字的宽度（mm） */
  width(text: string): number;
}

let cachedCtx: CanvasRenderingContext2D | null | undefined;
/** 当前画布上已经应用的字体（换字体才重新赋值，省掉大量 font 解析） */
let appliedFontKey = '';

function canvasCtx(): CanvasRenderingContext2D | null {
  if (cachedCtx !== undefined) return cachedCtx;
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      cachedCtx = null;
    } else {
      cachedCtx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    cachedCtx = null;
  }
  return cachedCtx;
}

function fontKeyOf(font: FontSpec): string {
  return `${font.weight ?? 400}|${font.sizePt}|${font.trackingEm ?? 0}|${font.family}`;
}

function cssFontOf(font: FontSpec): string {
  const px = Math.round(font.sizePt * (96 / 72) * 1000) / 1000;
  return `${font.weight ?? 400} ${px}px ${font.family}`;
}

const measurerCache = new Map<string, Measurer>();

/** 无画布时的字宽表兜底（Node / SSR 用；只求不崩，不求精确） */
function approxWidthMm(text: string, sizePt: number): number {
  const em = sizePt * PT_TO_MM;
  let n = 0;
  for (const ch of Array.from(text)) {
    if (ch === ' ') n += 0.28;
    else if (isWideChar(ch)) n += 1;
    else if (/[0-9]/.test(ch)) n += 0.52;
    else if (/[A-Z]/.test(ch)) n += 0.68;
    else n += 0.5;
  }
  return n * em;
}

function measurerFor(font: FontSpec): Measurer {
  const key = fontKeyOf(font);
  const hit = measurerCache.get(key);
  if (hit) return hit;

  const ctx = canvasCtx();
  let measurer: Measurer;
  if (ctx) {
    const cache = new Map<string, number>();
    measurer = {
      width(text: string): number {
        const cached = cache.get(text);
        if (cached !== undefined) return cached;
        if (appliedFontKey !== key) {
          ctx.font = cssFontOf(font);
          try {
            // Chromium 99+ 支持 canvas letterSpacing，和 CSS letter-spacing 同口径
            (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${font.trackingEm ?? 0}em`;
          } catch {
            /* 老引擎没有这个属性，忽略 */
          }
          appliedFontKey = key;
        }
        const w = ctx.measureText(text).width / PX_PER_MM;
        if (cache.size < 40000) cache.set(text, w);
        return w;
      },
    };
  } else {
    measurer = { width: (text: string) => approxWidthMm(text, font.sizePt) };
  }

  measurerCache.set(key, measurer);
  return measurer;
}

/* ------------------------------- 断行 ------------------------------- */

/**
 * 把一段文字按宽度折成若干行。
 *
 * 断行策略刻意和 Chromium 一致：
 *   1. 先二分出「这一行最多能塞到第几个字」；
 *   2. 再从那里往前找最近的**合法断点**（避头尾已经编码在 canBreakAfterAt 里）；
 *   3. 一个字都找不到合法断点时（超长英文单词、长 URL），按字符强制断，
 *      相当于 CSS 的 overflow-wrap:anywhere —— 宁可断开单词，也不能横向溢出被裁。
 */
export function wrapDetail(text: string, widthMm: number, font: FontSpec, opts: WrapOptions = {}): WrapResult {
  const clean = text.includes('\n') || /[ \t]{2,}/.test(text) ? normalizeText(text) : text;
  const chars = Array.from(clean);
  const n = chars.length;
  const measurer = measurerFor(font);
  const safe = opts.safeMm ?? WRAP_SAFE_MM;
  const indentMm = (opts.firstIndentEm ?? 0) * font.sizePt * PT_TO_MM;

  const lines: string[] = [];
  const ends: number[] = [];
  let i = 0;

  while (i < n) {
    // 行首空白吞掉（CSS 里行首空格不占位）
    while (i < n && chars[i] === ' ') i += 1;
    if (i >= n) break;

    const avail = Math.max(1, widthMm - (lines.length === 0 ? indentMm : 0) - safe);
    const widthOf = (end: number): number => measurer.width(chars.slice(i, end).join(''));

    // 二分：找最长的、宽度不超 avail 的前缀
    let lo = i + 1;
    let hi = n;
    let fit = i;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (widthOf(mid) <= avail) {
        fit = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // 字偶距之类的非单调效应：再往后试两个字，能塞就塞
    if (fit >= i + 1 && fit < n) {
      for (let extra = 1; extra <= 2; extra += 1) {
        const cand = fit + extra;
        if (cand > n) break;
        if (widthOf(cand) <= avail) fit = cand;
        else break;
      }
    }
    // 回退到真正塞得下的长度
    while (fit > i + 1 && widthOf(fit) > avail) fit -= 1;
    // 一个字都塞不下（栏宽比字还窄）：强行放一个字，保证循环一定前进
    if (fit < i + 1) fit = Math.min(n, i + 1);

    let end = fit;
    if (fit < n) {
      // 从放得下的最后一个位置往前找合法断点
      let b = fit;
      while (b > i && !canBreakAfterAt(chars, b - 1)) b -= 1;
      end = b > i ? b : fit; // 找不到合法断点 → 强制断（equivalent to overflow-wrap:anywhere）
    }
    if (end <= i) end = Math.min(n, i + 1);

    lines.push(chars.slice(i, end).join(''));
    ends.push(end);
    i = end;
  }

  if (lines.length === 0) {
    lines.push('');
    ends.push(0);
  }
  return { lines, ends };
}

/** 只要行数 / 行文本 */
export function wrapText(text: string, widthMm: number, font: FontSpec, opts: WrapOptions = {}): string[] {
  return wrapDetail(text, widthMm, font, opts).lines;
}

/** 一段文字在给定宽度下占多高（mm）—— 毫米预算的唯一入口 */
export function measureHeightMm(text: string, widthMm: number, font: FontSpec, opts: WrapOptions = {}): number {
  if (!text.trim() || widthMm <= 0) return 0;
  return wrapDetail(text, widthMm, font, opts).lines.length * lineHeightMm(font);
}

/** 单行文字的真实宽度（mm）—— 胶囊这种「宽度参与折行」的短文本要用 */
export function singleLineWidthMm(text: string, font: FontSpec): number {
  if (!text) return 0;
  return measurerFor(font).width(normalizeText(text));
}

/** 一段文字在给定宽度下排几行 */
export function measureLines(text: string, widthMm: number, font: FontSpec, opts: WrapOptions = {}): number {
  if (!text.trim() || widthMm <= 0) return 0;
  return wrapDetail(text, widthMm, font, opts).lines.length;
}

/* ----------------------------- 截断 / 缩放 ----------------------------- */

/** 消除孤行时尝试的字距阶梯（em）：慢慢收紧，最多 3% */
const TRACKING_LADDER = [0, -0.005, -0.01, -0.015, -0.02, -0.03];

/** 一行里有多少个「可见字」（宽字符算 1，西文按 0.5 折算） */
function visibleLength(line: string): number {
  let n = 0;
  for (const ch of Array.from(line)) {
    if (ch === ' ') n += 0.3;
    else if (isWideChar(ch)) n += 1;
    else n += 0.55;
  }
  return n;
}

/**
 * 在「宽度固定、高度固定」的框里排一段文字。
 *
 * 顺序：
 *   1. 完整排得下 → 原样返回（不补省略号）；
 *   2. 排不下 → 从尾部按**整句**丢（分句见 kinsoku.ts），丢到能排下为止；
 *   3. 连第一句都排不下 → 按行切，末尾补「…」，并保证「…」自身也排得进去。
 *
 * 另外顺手处理孤行：段落最后一行只剩一两个字时，微收字距试着把它挤进上一行
 * （trackingEm 会写进渲染的 style，测量与渲染保持同一口径）。
 */
export function fitText(
  text: string,
  widthMm: number,
  maxHeightMm: number,
  font: FontSpec,
  opts: WrapOptions & { ellipsis?: string } = {},
): FitResult {
  const ellipsis = opts.ellipsis ?? '…';
  const clean = normalizeText(text);
  const lineH = lineHeightMm(font);
  const maxLines = maxHeightMm > 0 ? Math.max(1, Math.floor((maxHeightMm + 1e-6) / lineH)) : 1;

  if (!clean) return { text: '', lines: 0, heightMm: 0, truncated: false, trackingEm: 0 };

  const full = wrapDetail(clean, widthMm, font, opts);
  if (full.lines.length <= maxLines) {
    return finish(clean, full, maxLines, false, widthMm, font, opts);
  }

  // ② 按整句丢尾
  const sentences = splitSentences(clean);
  for (let keep = sentences.length - 1; keep >= 1; keep -= 1) {
    const cand = trimClausePunct(sentences.slice(0, keep).join('')) + ellipsis;
    const wrapped = wrapDetail(cand, widthMm, font, opts);
    if (wrapped.lines.length <= maxLines) {
      return {
        text: cand,
        lines: wrapped.lines.length,
        heightMm: wrapped.lines.length * lineH,
        truncated: true,
        trackingEm: 0,
      };
    }
  }

  // ③ 一句都放不下：按行切 + 省略号
  const cutIndex = Math.min(maxLines, full.ends.length) - 1;
  let cut = clean.slice(0, full.ends[cutIndex]).trimEnd();
  while (cut.length > 0) {
    const chars = Array.from(cut);
    // 省略号不要跟在一个开括号后面
    if (NO_END.has(chars[chars.length - 1] ?? '')) {
      cut = chars.slice(0, -1).join('').trimEnd();
      continue;
    }
    const cand = cut + ellipsis;
    const wrapped = wrapDetail(cand, widthMm, font, opts);
    if (wrapped.lines.length <= maxLines) {
      return {
        text: cand,
        lines: wrapped.lines.length,
        heightMm: wrapped.lines.length * lineH,
        truncated: true,
        trackingEm: 0,
      };
    }
    cut = chars.slice(0, -1).join('').trimEnd();
  }
  return { text: ellipsis, lines: 1, heightMm: lineH, truncated: true, trackingEm: 0 };
}

/**
 * 截断收尾：把「；，、：」这类句中标点擦掉再接省略号。
 * 「雨声还在响；…」读着像被硬切断，「雨声还在响…」才像一句说完。
 * 句末的 。！？ 保留（"他说完就走了。…" 不合中文习惯，但那种情况整句已经算完整、
 * 走的是另一条分支，不会走到这里）。
 */
function trimClausePunct(text: string): string {
  return text.replace(/[，,、；;：:\u3000\s]+$/u, '');
}

/** 未截断时挑一档字距，把「孤字末行」挤进上一行 */
function finish(
  text: string,
  full: WrapResult,
  maxLines: number,
  truncated: boolean,
  widthMm: number,
  font: FontSpec,
  opts: WrapOptions,
): FitResult {
  const lineH = lineHeightMm(font);
  const base: FitResult = {
    text,
    lines: full.lines.length,
    heightMm: full.lines.length * lineH,
    truncated,
    trackingEm: 0,
  };
  if (full.lines.length < 3) return base;
  const lastLen = visibleLength(full.lines[full.lines.length - 1]);
  if (lastLen > 1.6) return base;

  for (const t of TRACKING_LADDER) {
    if (t === 0) continue;
    const wrapped = wrapDetail(text, widthMm, { ...font, trackingEm: t }, opts);
    if (wrapped.lines.length > maxLines) continue;
    const tail = visibleLength(wrapped.lines[wrapped.lines.length - 1]);
    if (wrapped.lines.length < full.lines.length && tail > 1.6) {
      return {
        text,
        lines: wrapped.lines.length,
        heightMm: wrapped.lines.length * lineH,
        truncated,
        trackingEm: t,
      };
    }
  }
  return base;
}

/**
 * 只需要「排得下几行」时的便捷函数：把高度上限换成行数上限。
 * 网格积木的盒子高度是规划死的，用它换算最直接。
 */
export function linesForHeight(maxHeightMm: number, font: FontSpec): number {
  return Math.max(1, Math.floor((maxHeightMm + 1e-6) / lineHeightMm(font)));
}

/**
 * 这一段该两端对齐还是左对齐。
 *
 * 中文每个字等宽，两端对齐只调节字间空隙，读起来是「齐边」；
 * 西文放到窄栏里（排版台把正文摆成 3~4 列 ≈ 5cm），两端对齐会把一行几个词
 * 拉成词间大洞，比不齐还难看。按字符占比决定：西文占多数就退回左对齐。
 * 两套引擎（网格 / 竖排）共用同一口径，同一段文字在哪儿排都一个样。
 */
export function preferredAlign(text: string): 'justify' | 'left' {
  const cjk = (text.match(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  return latin > cjk ? 'left' : 'justify';
}
