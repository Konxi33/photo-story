// src/lib/export/pdf-design.ts
// 0.6.5：PDF 竖排照片页 —— 一条统一左边线、字号层级固定、图注贴图片左边线、
// 页码永远在页脚外侧，绝不裁字。
//
// 版本史（每一版都对应一类用户报的「字被截掉」）：
// - 0.6.3：`.gitem .techs { max-height:100%; overflow:hidden }` 直接把超出的条目切掉；
// - 0.6.4：改成「毫米预算」，但预算里的行数是用 emCount 估的（widthCm-0.2 除以字号），
//   真实渲染的字体/标点宽度比估算宽，估价偏低时最后一行就顶出 `.pg` 的固定高度，
//   被页面边界（或下一页的分页）切掉 —— 用户说的「文字割裂、下面看不到了」。
// - 0.6.5（本版）：预算改成 **canvas measureText 真实测量**（text-measure.ts），
//   并且把「装不下」的处理从「溢出后靠 CSS 裁」改成「先在毫米预算里降字号 → 缩图 →
//   按整句缩短正文（末尾省略号）」，`.pg` 的固定高度与内容高度因此永远自洽。
//   另外给页面底部留 SAFE_BOTTOM_MM 的呼吸位，页码不会压到正文。

import {
  type FontSpec,
  fitText,
  lineHeightMm,
  makeFont,
  measureLines,
  normalizeText,
  preferredAlign,
  type WrapOptions,
} from './text-measure';
import {
  type PageStyle,
  type TypeSpec,
  chapterNumber,
  tidyReading,
} from './typography';

export interface Tint {
  bg: string;
  ink: string;
  inkSoft: string;
  line: string;
}

export interface PageEnv {
  style: PageStyle;
  tint: Tint;
  /** 版心宽 / 高（mm） */
  contentW: number;
  contentH: number;
  serifCss: string;
  sansCss: string;
}

export interface FigureInput {
  env: PageEnv;
  /** 书籍内连续页码（不含封面） */
  pageNo: number;
  /** 图号（1 起） */
  index: number;
  /** 章节头（只有紧凑章节的第一张照片才给） */
  chapter?: { no: number; title: string; note?: string };
  /** data URL；null 表示这张图编码失败 */
  url: string | null;
  /** 图片原始像素尺寸，用来算宽高比 */
  imgW: number;
  imgH: number;
  title: string;
  story?: string;
  /** 图注里的参数行（已排好序的 text，没有就不印） */
  specLine?: string;
  /** 拍摄手法 5 条（技术档案用） */
  technique?: { label: string; text: string }[];
  /** 评分 */
  score?: { overall: number; parts: [string, number][] };
  tags?: string[];
  mood?: string;
}

const GAP_TITLE_FIG = 4;
const GAP_FIG_CAP = 2.5;
const GAP_CAP_BODY = 6;
const GAP_BODY_META = 6;
const GAP_META_ROW = 1.4;
const MIN_IMAGE_MM = 46;

/**
 * 版心底部预留（mm）：页码贴着版心底线排，正文必须离底 ≥ 这个距离，
 * 否则页码会压在最后一行上（打印出来就是「字被盖住」）。
 * 取 9mm = 页码行高 4.5mm 外加 4.5mm 空隙，页脚才有呼吸的余地。
 */
const SAFE_BOTTOM_MM = 9;

/** 页码行高（mm）：预留高度与 CSS 的 `.pg-folio` 字号对齐 */
const FOLIO_H_MM = 4.5;

/** 图注最多占版心高度的比例：超长图注会把照片压成邮票，宁可按整句缩短图注 */
const CAP_MAX_RATIO = 0.18;

interface MetaRow {
  html: string;
  heightMm: number;
  /** 越小越先留 */
  priority: number;
}

/** 把排版规格换成测量规格：字号/行高/字重/字距与 CSS 完全一致 */
function typeFont(env: PageEnv, t: TypeSpec): FontSpec {
  return makeFont(t.family === 'sans' ? env.sansCss : env.serifCss, t.sizePt, t.linePt, t.weight, t.tracking);
}

/** 一段文字在给定宽度下的行数与高度（mm）—— 全文件唯一的测量入口 */
function textMm(
  env: PageEnv,
  text: string,
  widthMm: number,
  t: TypeSpec,
  opts: WrapOptions = {},
): { lines: number; mm: number } {
  if (!text.trim() || widthMm <= 0) return { lines: 0, mm: 0 };
  const font = typeFont(env, t);
  const lines = measureLines(text, widthMm, font, opts);
  return { lines, mm: lines * lineHeightMm(font) };
}

/** 章头高度：章号 / 章名 / 题记挤在一条基线上，章名长了会折行，必须实测 */
function chapterBlockHeight(env: PageEnv, chapter: NonNullable<FigureInput['chapter']>): number {
  const s = env.style;
  const titleWidth = Math.max(40, env.contentW * 0.62);
  const noteWidth = Math.max(30, env.contentW * 0.3);
  const titleLines = measureLines(chapter.title, titleWidth, typeFont(env, s.chapterTitle));
  const noteLines = chapter.note ? measureLines(chapter.note, noteWidth, typeFont(env, s.chapterNote)) : 0;
  const lines = Math.max(1, titleLines, noteLines);
  return lines * lineHeightMm(typeFont(env, s.chapterTitle)) + 5;
}

/**
 * 图注文案。
 * 0.8.3：以前这里是「— 01 标题 · 参数」，而标题已经印在图上方了 ——
 * 同一行字在一页里出现两遍，页面看着又乱又重复（用户原话「标题旁有个小数字」）。
 * 现在图注只承担标题没说的信息：拍摄参数。没有参数就干脆不印图注。
 */
export function captionText(index: number, s: PageStyle, title: string, specLine?: string): string {
  void index;
  void s;
  void title;
  return specLine ? `—　${specLine}` : '';
}

/**
 * 照片页的毫米预算。
 * 返回图框尺寸与各块的实际高度；调用方照着写死宽度高度，PDF 里就不会有第二次排版。
 */
export function planFigurePage(input: FigureInput): {
  imgW: number;
  imgH: number;
  imgLeft: number;
  capWidth: number;
  /** 正文栏宽与左边距：中文一行 28–34 字最舒服，所以正文不铺满整个版心 */
  bodyWidth: number;
  bodyLeft: number;
  body: TypeSpec;
  /** 实际排进页面的正文（可能被按整句缩短过） */
  bodyText: string;
  bodyMm: number;
  /** 实际排进页面的图注 */
  capText: string;
  meta: string[];
  chapterMm: number;
  titleMm: number;
  totalMm: number;
} {
  const { env } = input;
  const s = env.style;
  // 可用高度：扣掉页脚呼吸位，内容永远不会压到页码
  const usableH = env.contentH - SAFE_BOTTOM_MM;
  const chapterMm = input.chapter ? chapterBlockHeight(env, input.chapter) : 0;

  // 正文栏：12 栏里的 8 栏 = 112mm ≈ 每行 30 个汉字（比铺满版心的 46 字好读）
  const contentW = env.contentW;
  const bodyWidth = Math.min(contentW, 112);
  const storyText = normalizeText(input.story ?? '');
  const indentEm = s.bodyIndent ? 2 : 0;

  // 正文：字号可以往下走两档（10.5 → 10 → 9.5），到最小档仍装不下就让图变小、最后才缩文字。
  const bodyCandidates = [s.body, { ...s.body, sizePt: s.body.sizePt - 0.5 }, { ...s.body, sizePt: s.body.sizePt - 1 }];
  // 阶梯行距按比例同步收缩，保持同样的疏密感
  const ladder = bodyCandidates.map((b) => ({
    ...b,
    linePt: Math.round(b.sizePt * (s.body.linePt / s.body.sizePt) * 20) / 20,
  }));

  const baseTitle = normalizeText(input.title);
  const aspect = input.imgW > 0 && input.imgH > 0 ? input.imgW / input.imgH : 3 / 2;
  // 图注宽度：跟着图走，但最窄 54mm、最宽 112mm（长图注读不动）
  const capTextFull = captionText(input.index, s, baseTitle, input.specLine);
  // 标题与正文栏共用左边线；0.8.3 起标题行不再挤一个图号，宽度按正文栏保守估
  const titleWidth = Math.max(40, bodyWidth - 8);
  const titleLines = measureLines(baseTitle, titleWidth, typeFont(env, s.pageTitle));
  const titleMm = Math.max(1, titleLines) * lineHeightMm(typeFont(env, s.pageTitle)) + GAP_TITLE_FIG;
  const capMaxMm = usableH * CAP_MAX_RATIO;

  // 0.8.3：**照片优先吃满剩下的高度**。
  // 老算法把图片封顶在「版心高 × maxHeightRatio」（极简画册 0.7，横构图还被宽度卡成 44%），
  // 于是图下面空半页 —— 用户说的「很多空的白区域」。现在：先把文字高度算清，
  // 剩下的高度全给照片（仍受版心宽度与 0.92 页高约束）。
  // 只有「刻意要小图」的版式（文艺随笔 0.5 / 技术档案 0.46）保留上限。
  const styleCapH =
    s.photo.maxHeightRatio >= 0.65 ? Number.POSITIVE_INFINITY : env.contentH * s.photo.maxHeightRatio;
  const byWidthH = contentW / aspect;
  const capWidthFull = Math.min(Math.max(54, contentW), Math.min(112, contentW));

  let best: ReturnType<typeof planFigurePage> | null = null;

  for (const body of ladder) {
    const bodyFont = typeFont(env, body);
    const bodyLines = storyText ? measureLines(storyText, bodyWidth, bodyFont, { firstIndentEm: indentEm }) : 0;
    const bodyNeed = bodyLines * lineHeightMm(bodyFont);

    const capNeedRawFull = textMm(env, capTextFull, capWidthFull, s.caption).mm;
    const capNeed = Math.min(capNeedRawFull, capMaxMm) + GAP_FIG_CAP;
    const fixed = chapterMm + titleMm + capNeed + (storyText ? GAP_CAP_BODY + bodyNeed : 0) + GAP_BODY_META;
    const roomForImage = usableH - fixed;
    const preferred = Math.min(byWidthH, roomForImage, env.contentH * 0.92, styleCapH);
    const useH = Math.max(MIN_IMAGE_MM, preferred);
    const useW = useH * aspect;
    const total = fixed + useH;

    if (total <= usableH + 0.2) {
      const capWidth = Math.min(Math.max(54, useW), Math.min(112, contentW));
      const capNeedRaw = textMm(env, capTextFull, capWidth, s.caption).mm;
      const metaRoom = Math.max(0, usableH - total - GAP_BODY_META);
      const metaWidth = Math.min(bodyWidth, useW);
      const meta = buildMeta(input, env, metaRoom, metaWidth);
      const capFit = fitText(capTextFull, capWidth, capNeedRaw > capMaxMm ? capMaxMm : capNeedRaw, typeFont(env, s.caption));
      const imgLeft = s.photo.align === 'center' ? Math.max(0, (contentW - useW) / 2) : 0;
      best = {
        imgW: useW,
        imgH: useH,
        imgLeft,
        capWidth,
        bodyWidth,
        // 正文跟图对齐同一条左边线，但不出右边版心
        bodyLeft: Math.max(0, Math.min(imgLeft, contentW - bodyWidth)),
        body,
        bodyText: storyText,
        bodyMm: bodyNeed,
        capText: capFit.text,
        meta,
        chapterMm,
        titleMm,
        totalMm: total,
      };
      break;
    }
    if (best) break;
  }

  if (!best) {
    // 兜底：图最小 + 正文最小档，正文再按整句缩短到「一定装得下」——
    // 宁可少印后半句（末尾带省略号），也绝不把最后一行立在页面外面被裁掉。
    const body = ladder[ladder.length - 1];
    const bodyFont = typeFont(env, body);
    const imgH = MIN_IMAGE_MM;
    const imgW = imgH * aspect;
    const capWidth = Math.min(Math.max(54, imgW), Math.min(112, contentW));
    const capNeedRaw = textMm(env, capTextFull, capWidth, s.caption).mm;
    const capBudget = Math.max(0, Math.min(capNeedRaw, capMaxMm));
    const imgLeft = s.photo.align === 'center' ? Math.max(0, (contentW - imgW) / 2) : 0;

    const capFit = fitText(capTextFull, capWidth, capBudget, typeFont(env, s.caption));
    const fixedNoBody = chapterMm + titleMm + capBudget + GAP_FIG_CAP + GAP_BODY_META + imgH;
    // 正文能用的高度：剩下的全部（若已经为负，fitText 会返回空串，这页只剩图与图注）
    const bodyRoom = usableH - fixedNoBody - (storyText ? GAP_CAP_BODY : 0);
    const bodyFit = storyText
      ? fitText(storyText, bodyWidth, Math.max(0, bodyRoom), bodyFont, { firstIndentEm: indentEm })
      : { text: '', lines: 0, heightMm: 0, truncated: false, trackingEm: 0 };

    best = {
      imgW,
      imgH,
      imgLeft,
      capWidth,
      bodyWidth,
      bodyLeft: Math.max(0, Math.min(imgLeft, contentW - bodyWidth)),
      body,
      bodyText: bodyFit.text,
      bodyMm: bodyFit.heightMm,
      capText: capFit.text,
      meta: [],
      chapterMm,
      titleMm,
      totalMm: fixedNoBody + bodyFit.heightMm + (storyText ? GAP_CAP_BODY : 0),
    };
  }

  return best;
}

/** 剩下的高度能给什么小字块，就印什么（整块给，不给半块） */
function buildMeta(input: FigureInput, env: PageEnv, roomMm: number, widthMm: number): string[] {
  const s = env.style;
  const rows: MetaRow[] = [];
  const wide = env.contentW;

  if (s.id === 'archive' && input.technique && input.technique.length > 0) {
    const html = `<div class="pg-tech">${input.technique
      .map(
        (t) =>
          `<div class="pg-tech-row"><span>${escapeHtml(t.label)}</span><p>${escapeHtml(t.text)}</p></div>`,
      )
      .join('')}</div>`;
    // 技术档案：左边 14mm 标签栏 + 3mm 间距，正文只有剩下的宽度
    const textWidth = Math.max(20, wide - 17);
    const h = input.technique.reduce((sum, t) => sum + textMm(env, t.text, textWidth, s.specText).mm + GAP_META_ROW, 0);
    rows.push({ html, heightMm: h, priority: 0 });
  }
  if (input.specLine) {
    rows.push({
      html: `<p class="pg-spec">${escapeHtml(input.specLine)}</p>`,
      heightMm: textMm(env, input.specLine, widthMm, s.specText).mm + GAP_META_ROW,
      priority: 1,
    });
  }
  if (input.score) {
    const parts = input.score.parts.map(([k, v]) => `${k} ${Math.round(v)}`).join('\u00a0· ');
    const html = `<p class="pg-score"><b>${input.score.overall.toFixed(1)}</b>/100　${escapeHtml(parts)}</p>`;
    // 总分数字比正文大 3pt，单独一行测高度（不会再挤成两行）
    const text = `${input.score.overall.toFixed(1)}/100　${parts}`;
    rows.push({
      html,
      heightMm: textMm(env, text, widthMm, s.specText).mm + 1.6 + GAP_META_ROW,
      priority: 2,
    });
  }
  const tail = [input.tags && input.tags.length > 0 ? input.tags.map((t) => `#${t}`).join('　') : '', input.mood ?? '']
    .filter(Boolean)
    .join('　');
  if (tail) {
    rows.push({
      html: `<p class="pg-tail">${escapeHtml(tail)}</p>`,
      heightMm: textMm(env, tail, widthMm, s.specText).mm + GAP_META_ROW,
      priority: 3,
    });
  }

  rows.sort((a, b) => a.priority - b.priority);
  const out: string[] = [];
  let used = 0;
  for (const row of rows) {
    if (used + row.heightMm > roomMm) break;
    out.push(row.html);
    used += row.heightMm;
  }
  return out;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 渲染一页照片（高度写死 = 版心高，保证一页一张、不会溢出到下一页） */
export function renderFigurePage(input: FigureInput): string {
  const { env } = input;
  const s = env.style;
  const plan = planFigurePage(input);
  const html: string[] = [];

  // 0.8.3：整块内容在版心里**居中**。
  // 以前把富余高度的 40% 放上方、其余全留底，横构图（宽度卡死、只占 44% 页高）就成了
  // 「上面一小条、下面半页白」—— 看着像排崩了。现在上下各分一半，留白看起来是版式取舍。
  const slack = env.contentH - plan.totalMm;
  const topPad = slack > 6 ? Math.min(slack * 0.5, 96) : 0;
  html.push(`<section class="pg">`);
  html.push(`<div class="pg-flow"${topPad > 0 ? ` style="padding-top:${topPad.toFixed(1)}mm"` : ''}>`);

  if (input.chapter) {
    html.push(`<div class="pg-chapter">
      <span class="pg-chapter-no">${escapeHtml(chapterNumber(input.chapter.no))}</span>
      <h3 class="pg-chapter-title">${escapeHtml(input.chapter.title)}</h3>
      ${input.chapter.note ? `<span class="pg-chapter-note">${escapeHtml(input.chapter.note)}</span>` : ''}
    </div>`);
  }

  // 页内标题与图号跟照片（或正文栏）共用同一条左边线，页面只允许一条竖线
  // 0.7.7：标题按字数让字号——长标题不该硬挤成两行小字，也不该把图片挤矮
  const titleChars = [...normalizeText(input.title)].length;
  const titleScale = titleChars > 20 ? 0.72 : titleChars > 14 ? 0.82 : titleChars > 10 ? 0.92 : 1;
  const titlePt = (s.pageTitle.sizePt * titleScale).toFixed(1);
  html.push(`<div class="pg-head" style="margin-left:${plan.bodyLeft.toFixed(1)}mm;width:${Math.max(plan.bodyWidth, plan.imgW).toFixed(1)}mm"><h2 class="pg-title" style="font-size:${titlePt}pt">${escapeHtml(normalizeText(input.title))}</h2></div>`);

  if (input.url) {
    const matte = s.photo.matteMm > 0 ? ` padding:${s.photo.matteMm}mm;` : '';
    const radius = s.photo.radiusMm > 0 ? ` border-radius:${s.photo.radiusMm}mm;` : '';
    const border = s.photo.borderPt > 0 ? ` border:${s.photo.borderPt}pt solid ${env.tint.line};` : '';
    html.push(`<figure class="pg-photo" style="width:${(plan.imgW + s.photo.matteMm * 2).toFixed(1)}mm;margin-left:${Math.max(0, plan.imgLeft - s.photo.matteMm).toFixed(1)}mm">
      <img src="${input.url}" alt="${escapeHtml(input.title)}" style="width:${plan.imgW.toFixed(1)}mm;height:${plan.imgH.toFixed(1)}mm;${matte}${radius}${border}">
    </figure>`);
  } else {
    html.push(`<div class="pg-photo-ph" style="width:${plan.imgW.toFixed(1)}mm;height:${plan.imgH.toFixed(1)}mm;margin-left:${plan.imgLeft.toFixed(1)}mm"></div>`);
  }

  if (plan.capText) {
    html.push(
      `<p class="pg-cap" style="width:${plan.capWidth.toFixed(1)}mm;margin-left:${plan.imgLeft.toFixed(1)}mm">${escapeHtml(plan.capText)}</p>`,
    );
  }

  if (plan.bodyText) {
    // 两端对齐只对中文好看：西文在 112mm 正文栏里也会被拉出词间大洞，退回左对齐
    const align = preferredAlign(plan.bodyText);
    // 字号阶梯算出来的字号必须落到真实排版上，否则「按 9.5pt 量、按 10.5pt 印」会凭空多出两行
    const bodyFont = typeFont(env, plan.body);
    const bodyLineMm = lineHeightMm(bodyFont);
    // data-lines 是我们测出来的行数，只给验收脚本核对「测量 vs 浏览器真实断行」用
    const bodyLines = Math.max(1, Math.round(plan.bodyMm / bodyLineMm));
    html.push(
      `<p class="pg-story" data-lines="${bodyLines}" style="width:${plan.bodyWidth.toFixed(1)}mm;margin-left:${plan.bodyLeft.toFixed(1)}mm;` +
        `text-align:${align};font-size:${plan.body.sizePt}pt;line-height:${bodyLineMm.toFixed(2)}mm;` +
        `letter-spacing:${plan.body.tracking}em">` +
        `${escapeHtml(tidyReading(plan.bodyText))}</p>`,
    );
  }

  if (plan.meta.length > 0) {
    html.push(
      `<div class="pg-meta" style="width:${Math.min(plan.bodyWidth, plan.imgW).toFixed(1)}mm;margin-left:${plan.bodyLeft.toFixed(1)}mm">${plan.meta.join('')}</div>`,
    );
  }

  html.push(`</div>`);
  if (s.showFolio) html.push(`<p class="pg-folio">${input.pageNo}</p>`);
  html.push(`</section>`);
  return html.join('');
}

/**
 * 章扉页：单独一页，章号 + 章名 + 题记，全部贴同一条左边线。
 * 上半页留白、下半页也留白 —— 画册的章扉从来不是「标题居中放中间」，
 * 而是让眼睛先歇一下，再翻到照片。
 */
export function renderChapterPage(_env: PageEnv, chapter: { no: number; title: string; note?: string }): string {
  return `<section class="pg pg-chapter-page">
  <div class="cp-block">
    <p class="pg-chapter-no">${escapeHtml(chapterNumber(chapter.no))}</p>
    <h2 class="cp-title">${escapeHtml(chapter.title)}</h2>
    <div class="cp-rule"></div>
    ${chapter.note ? `<p class="pg-chapter-note">${escapeHtml(chapter.note)}</p>` : ''}
  </div>
</section>`;
}

/** 版式 CSS（只作用于 .pg* 类，不动老的封面/总览样式） */
export function designCss(env: PageEnv): string {
  const s = env.style;
  const t = (x: TypeSpec, extra = ''): string =>
    `font-family:${x.family === 'sans' ? env.sansCss : env.serifCss};font-size:${x.sizePt}pt;` +
    `line-height:${lineHeightMm(x).toFixed(2)}mm;letter-spacing:${x.tracking}em;font-weight:${x.weight};${extra}`;
  const color = (c: TypeSpec['color']): string =>
    c === 'soft' ? env.tint.inkSoft : c === 'line' ? env.tint.line : c === 'accent' ? (s.accent ?? env.tint.ink) : env.tint.ink;

  return `
  /* 0.8.3：一页 = 一张纸。铺满整张纸并自己留出页边距，
     这样米白/灰色/夜色纸能铺到纸边（以前只铺版心，四周永远是打印机的白纸）。 */
  .pg { position: relative; width: var(--paper-w, ${(env.contentW + 44).toFixed(1)}mm);
    height: var(--paper-h, ${(env.contentH + 44).toFixed(1)}mm);
    padding: var(--m-top, 22mm) var(--m-right, 22mm) var(--m-bottom, 22mm) var(--m-left, 22mm);
    background: var(--paper, #fff); overflow: visible;
    display: block; page-break-inside: avoid; break-inside: avoid; }
  .pg + .pg { break-before: page; page-break-before: always; }
  .pg-flow { display: block; }
  .pg-chapter { display: flex; align-items: baseline; gap: 3mm; margin: 0 0 5mm; }
  .pg-chapter-no { margin: 0; color: ${color(s.chapterNo.color)}; ${t(s.chapterNo)} text-transform: none; }
  .pg-chapter-title { margin: 0; color: ${color(s.chapterTitle.color)}; ${t(s.chapterTitle)} }
  .pg-chapter-note { margin: 0 0 0 auto; color: ${color(s.chapterNote.color)}; ${t(s.chapterNote)} }
  .pg-head { display: block; margin: 0 0 ${GAP_TITLE_FIG}mm; break-inside: avoid; break-after: avoid; }
  /* 标题：两行时按词意均衡断行，不许第二行只剩一个字（0.7.5） */
  .pg-title { margin: 0; color: ${color(s.pageTitle.color)}; ${t(s.pageTitle)} overflow-wrap: anywhere;
    text-wrap: balance; text-align: left; max-width: ${Math.min(env.contentW, 118).toFixed(1)}mm; }
  /* 竖构图本该 177mm 高，老的 figure img 的 max-height 会把它硬压小，
     还因为 figure 的 text-align:center 整体右移 —— 这里按毫米预算写死尺寸，
     必须把老的约束全部解除。 */
  .pg-photo { margin: 0; text-align: left; }
  .pg-photo img { display: block; max-width: none; max-height: none; object-fit: contain; }
  .pg-photo-ph { background: #f2f2f2; border-radius: 1mm; }
  /* 图注：比正文小一号、颜色压灰、行首一道破折线 —— 与正文拉开层级，不糊在一起 */
  .pg-cap { margin: ${GAP_FIG_CAP}mm 0 0; color: ${color(s.caption.color)}; ${t(s.caption)}
    font-variant-numeric: tabular-nums; overflow-wrap: anywhere; break-inside: avoid; break-after: avoid; }
  /* 正文：首行缩进 2em、两端对齐、长单词允许断行（绝不横向溢出被裁）、数字等宽 */
  .pg-story { margin: ${GAP_CAP_BODY}mm 0 0; color: ${color(s.body.color)}; ${t(s.body)}
    ${s.bodyIndent ? 'text-indent: 2em;' : ''} ${s.bodyJustify ? 'text-align: justify;' : ''}
    text-justify: inter-ideograph; overflow-wrap: anywhere; word-break: normal;
    font-variant-numeric: tabular-nums; hyphens: none;
    /* 0.7.5：段落首尾不许只留一行（孤行/寡行控制），读起来才不像被切掉 */
    orphans: 2; widows: 2; }
  .pg-meta { margin: ${GAP_BODY_META}mm 0 0; padding-top: 3mm; border-top: 0.3pt solid ${env.tint.line}; }
  .pg-spec { margin: 0 0 ${GAP_META_ROW}mm; color: ${color(s.specText.color)}; ${t(s.specText)}
    font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .pg-score { margin: 0 0 ${GAP_META_ROW}mm; color: ${color(s.specText.color)}; ${t(s.specText)}
    font-variant-numeric: tabular-nums; }
  .pg-score b { font-weight: 600; color: ${env.tint.ink}; font-size: ${(s.specText.sizePt + 3).toFixed(1)}pt; }
  .pg-tail { margin: 0 0 ${GAP_META_ROW}mm; color: ${color(s.specText.color)}; ${t(s.specText)} }
  .pg-tech { margin: 0 0 ${GAP_META_ROW}mm; }
  .pg-tech-row { display: flex; gap: 3mm; break-inside: avoid; }
  .pg-tech-row span { flex: 0 0 14mm; color: ${env.tint.inkSoft}; ${t(s.specText)} }
  .pg-tech-row p { margin: 0; color: ${env.tint.ink}; ${t(s.specText)} }
  /* 页码：贴版心底线（不是页面底边），数字等宽，与正文之间留 SAFE_BOTTOM_MM */
  .pg-folio { position: absolute; bottom: 0; right: 0; margin: 0; height: ${FOLIO_H_MM}mm;
    line-height: ${FOLIO_H_MM}mm; color: ${color(s.folio.color)};
    ${t(s.folio)} font-variant-numeric: tabular-nums; }
  .pg-chapter-page { padding-top: calc(var(--m-top, 22mm) + 62mm); }
  .cp-block { max-width: 120mm; }
  .cp-title { margin: 3mm 0 0; color: ${env.tint.ink}; ${t(s.chapterTitle)} }
  .cp-rule { width: 28mm; height: 0.4pt; background: ${env.tint.line}; margin: 7mm 0; }
  `;
}
