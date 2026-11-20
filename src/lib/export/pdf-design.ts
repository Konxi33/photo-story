// src/lib/export/pdf-design.ts
// 0.6.4：PDF 的照片页改成「按摄影书版式排」——一条统一左边线、字号层级固定、
// 图注贴图片左边线、页码永远在页脚外侧，绝不裁字。
//
// 0.6.3 的老版式问题（用户截图坐实）：
// 1. 一堆元素居中、一堆元素左对齐，混在一起像 PPT；
// 2. 序号 / 标题 / 照片 / 参数 / 评分各有各的左边界，观感散；
// 3. `.gitem .techs { max-height:100%; overflow:hidden }` 直接把超出的建议条目切掉，
//    用户看到的「文字被截掉」就是它；
// 4. 页面没有页码。
//
// 这一版不再让 CSS 兜底：每一页在生成时就用「毫米预算」算好图高、正文行数，
// 装不下的块按优先级整块让位（整块不出现，而不是出现一半被切）。

import { measureTextCm } from './layout';
import {
  type PageStyle,
  type TypeSpec,
  PT_TO_MM,
  figureNumber,
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
  /** 版心顶部是否已经压了章头（让出高度由 budget 负责，这里只影响间距） */
}

const GAP_TITLE_FIG = 4;
const GAP_FIG_CAP = 2.5;
const GAP_CAP_BODY = 6;
const GAP_BODY_META = 6;
const GAP_META_ROW = 1.4;
const MIN_IMAGE_MM = 46;

interface MetaRow {
  html: string;
  heightMm: number;
  /** 越小越先留 */
  priority: number;
}

function lineMm(t: TypeSpec): number {
  return t.linePt * PT_TO_MM;
}

/** 一段文字在给定宽度下的行数与高度（mm） */
function textMm(text: string, widthMm: number, t: TypeSpec): { lines: number; mm: number } {
  const m = measureTextCm(text, widthMm / 10, t.sizePt, t.linePt / t.sizePt);
  return { lines: m.lines, mm: m.lines * lineMm(t) };
}

function chapterBlockHeight(env: PageEnv, chapter: NonNullable<FigureInput['chapter']>): number {
  const s = env.style;
  // 0.6.4：章号、章名、日期并成一行（原来三行 29.5mm，占掉整页 1/8，
  // 一页只有一张照片时会让照片被压得很小）。
  let h = lineMm(s.chapterTitle) + 5;
  if (chapter.note) h += 0;
  return h;
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
  bodyMm: number;
  meta: string[];
  chapterMm: number;
  titleMm: number;
  totalMm: number;
} {
  const { env } = input;
  const s = env.style;
  const chapterMm = input.chapter ? chapterBlockHeight(env, input.chapter) : 0;
  const titleMm = lineMm(s.pageTitle) + GAP_TITLE_FIG;

  // 正文：字号可以往下走两档（10.5 → 10 → 9.5），到 9pt 仍装不下就让图变小。
  const contentW = env.contentW;
  // 正文栏：12 栏里的 8 栏 = 112mm ≈ 每行 30 个汉字（比铺满版心的 46 字好读）
  const bodyWidth = Math.min(contentW, 112);
  const storyText = (input.story ?? '').trim();
  const bodyCandidates = [s.body, { ...s.body, sizePt: s.body.sizePt - 0.5 }, { ...s.body, sizePt: s.body.sizePt - 1 }];
  // 阶梯行距按比例同步收缩，保持同样的疏密感
  const ladder = bodyCandidates.map((b) => ({
    ...b,
    linePt: Math.round(b.sizePt * (s.body.linePt / s.body.sizePt) * 20) / 20,
  }));

  const capText = input.specLine ? `${figureNumber(input.index, s)}　${input.title}　·　${input.specLine}` : `${figureNumber(input.index, s)}　${input.title}`;
  const aspect = input.imgW > 0 && input.imgH > 0 ? input.imgW / input.imgH : 3 / 2;

  // 图注宽度：跟着图走，但最窄 54mm、最宽 112mm（长图注读不动）
  const imageMaxH = env.contentH * s.photo.maxHeightRatio;

  let best: ReturnType<typeof planFigurePage> | null = null;

  for (const body of ladder) {
    const bodyNeed = storyText ? textMm(storyText, bodyWidth, body).mm : 0;
    for (const shrink of [1, 0.92, 0.84]) {
      // 先按宽高比定出「图能多大」，再看剩下的高度够不够
      let imgH = Math.min(imageMaxH * shrink, env.contentH * 0.8);
      // 按宽度上限（版心）收一次
      if (imgH * aspect > contentW) imgH = contentW / aspect;
      const imgW = imgH * aspect;

      const capWidth = Math.min(Math.max(54, imgW), Math.min(112, contentW));
      const capNeed = textMm(capText, capWidth, s.caption).mm + GAP_FIG_CAP;
      const fixed = chapterMm + titleMm + capNeed + (storyText ? GAP_CAP_BODY + bodyNeed : 0) + GAP_BODY_META;
      const roomForImage = env.contentH - fixed;
      const useH = Math.min(imgH, Math.max(MIN_IMAGE_MM, roomForImage));
      const useW = useH * aspect;
      const total = fixed + useH;

      if (total <= env.contentH + 0.2) {
        const meta = buildMeta(input, env, env.contentH - total - GAP_BODY_META, capWidth);
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
          bodyMm: bodyNeed,
          meta,
          chapterMm,
          titleMm,
          totalMm: total,
        };
        break;
      }
    }
    if (best) break;
  }

  if (!best) {
    // 极端兜底：图最小、正文最小字号，绝不让文字落到下一页
    const body = ladder[ladder.length - 1];
    const bodyNeed = storyText ? textMm(storyText, bodyWidth, body).mm : 0;
    const imgH = MIN_IMAGE_MM;
    const imgW = imgH * aspect;
    const capWidth = Math.min(Math.max(54, imgW), Math.min(112, contentW));
    const capNeed = textMm(capText, capWidth, s.caption).mm + GAP_FIG_CAP;
    const imgLeft = s.photo.align === 'center' ? Math.max(0, (contentW - imgW) / 2) : 0;
    best = {
      imgW,
      imgH,
      imgLeft,
      capWidth,
      bodyWidth,
      bodyLeft: Math.max(0, Math.min(imgLeft, contentW - bodyWidth)),
      body,
      bodyMm: bodyNeed,
      meta: [],
      chapterMm,
      titleMm,
      totalMm: chapterMm + titleMm + capNeed + bodyNeed + imgH,
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
    const h = input.technique.reduce(
      (sum, t) => sum + textMm(t.text, wide - 16, s.specText).mm + GAP_META_ROW,
      0,
    );
    rows.push({ html, heightMm: h, priority: 0 });
  }
  if (input.specLine) {
    rows.push({
      html: `<p class="pg-spec">${escapeHtml(input.specLine)}</p>`,
      heightMm: lineMm(s.specText) + GAP_META_ROW,
      priority: 1,
    });
  }
  if (input.score) {
    const parts = input.score.parts.map(([k, v]) => `${k} ${Math.round(v)}`).join('  ·  ');
    rows.push({
      html: `<p class="pg-score"><b>${input.score.overall.toFixed(1)}</b>/100　${escapeHtml(parts)}</p>`,
      heightMm: lineMm(s.specText) + 1.6 + GAP_META_ROW,
      priority: 2,
    });
  }
  const tail = [input.tags && input.tags.length > 0 ? input.tags.map((t) => `#${t}`).join('　') : '', input.mood ?? '']
    .filter(Boolean)
    .join('　');
  if (tail) {
    const need = textMm(tail, widthMm, s.specText).mm + GAP_META_ROW;
    rows.push({
      html: `<p class="pg-tail">${escapeHtml(tail)}</p>`,
      heightMm: need,
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
  const aspect = input.imgW > 0 && input.imgH > 0 ? input.imgW / input.imgH : 3 / 2;
  void aspect;
  const html: string[] = [];

  // 0.6.4：整块内容在版心里垂直微调 —— 空白全留底下会像「排崩了」，
  // 把富余高度的 40% 放到上方，剩下留底，观感才像画册。
  const slack = env.contentH - plan.totalMm;
  const topPad = slack > 24 ? Math.min(slack * 0.4, 46) : 0;
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
  html.push(`<div class="pg-head" style="margin-left:${plan.bodyLeft.toFixed(1)}mm;width:${Math.max(plan.bodyWidth, plan.imgW).toFixed(1)}mm"><span class="pg-no">${figureNumber(input.index, s)}</span><h2 class="pg-title">${escapeHtml(input.title)}</h2></div>`);

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

  const capText = input.specLine
    ? `${figureNumber(input.index, s)}&ensp;${escapeHtml(input.title)}&ensp;·&ensp;${escapeHtml(input.specLine)}`
    : `${figureNumber(input.index, s)}&ensp;${escapeHtml(input.title)}`;
  html.push(`<p class="pg-cap" style="width:${plan.capWidth.toFixed(1)}mm;margin-left:${plan.imgLeft.toFixed(1)}mm">${capText}</p>`);

  if (input.story && input.story.trim()) {
    html.push(
      `<p class="pg-story" style="width:${plan.bodyWidth.toFixed(1)}mm;margin-left:${plan.bodyLeft.toFixed(1)}mm">` +
        `${escapeHtml(tidyReading(input.story))}</p>`,
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

/** 版式 CSS（只作用于 .pg* 类，不动老的封面/总览样式） */export function designCss(env: PageEnv): string {
  const s = env.style;
  const t = (x: TypeSpec, extra = ''): string =>
    `font-family:${x.family === 'sans' ? env.sansCss : env.serifCss};font-size:${x.sizePt}pt;` +
    `line-height:${lineMm(x).toFixed(2)}mm;letter-spacing:${x.tracking}em;font-weight:${x.weight};${extra}`;
  const color = (c: TypeSpec['color']): string =>
    c === 'soft' ? env.tint.inkSoft : c === 'line' ? env.tint.line : c === 'accent' ? (s.accent ?? env.tint.ink) : env.tint.ink;

  return `
  .pg { position: relative; height: ${env.contentH.toFixed(2)}mm; overflow: visible;
    display: block; page-break-inside: avoid; break-inside: avoid; }
  .pg + .pg { break-before: page; page-break-before: always; }
  .pg-flow { display: block; }
  .pg-chapter { display: flex; align-items: baseline; gap: 3mm; margin: 0 0 5mm; }
  .pg-chapter-no { margin: 0; color: ${color(s.chapterNo.color)}; ${t(s.chapterNo)} text-transform: none; }
  .pg-chapter-title { margin: 0; color: ${color(s.chapterTitle.color)}; ${t(s.chapterTitle)} }
  .pg-chapter-note { margin: 0 0 0 auto; color: ${color(s.chapterNote.color)}; ${t(s.chapterNote)} }
  .pg-head { display: flex; align-items: baseline; gap: 4mm; margin: 0 0 ${GAP_TITLE_FIG}mm; }
  .pg-no { color: ${color(s.captionNum.color)}; ${t(s.captionNum)} font-variant-numeric: tabular-nums; }
  .pg-title { margin: 0; color: ${color(s.pageTitle.color)}; ${t(s.pageTitle)} }
  /* 0.6.4 修正：老的 figure img 的 max-height 会把照片硬压小，
     竖构图本该 177mm 高，实际只画出 116mm，还因为 figure 的 text-align:center
     整体右移 —— 这里按毫米预算写死尺寸，必须把老的约束全部解除。 */
  .pg-photo { margin: 0; text-align: left; }
  .pg-photo img { display: block; max-width: none; max-height: none; object-fit: contain; }
  .pg-photo-ph { background: #f2f2f2; border-radius: 1mm; }
  .pg-cap { margin: ${GAP_FIG_CAP}mm 0 0; color: ${color(s.caption.color)}; ${t(s.caption)}
    font-variant-numeric: tabular-nums; }
  .pg-story { margin: ${GAP_CAP_BODY}mm 0 0; color: ${color(s.body.color)}; ${t(s.body)}
    ${s.bodyIndent ? 'text-indent: 2em;' : ''} ${s.bodyJustify ? 'text-align: justify;' : ''}
    text-justify: inter-ideograph; }
  .pg-meta { margin: ${GAP_BODY_META}mm 0 0; padding-top: 3mm; border-top: 0.3pt solid ${env.tint.line}; }
  .pg-spec { margin: 0 0 ${GAP_META_ROW}mm; color: ${color(s.specText.color)}; ${t(s.specText)}
    font-variant-numeric: tabular-nums; }
  .pg-score { margin: 0 0 ${GAP_META_ROW}mm; color: ${color(s.specText.color)}; ${t(s.specText)}
    font-variant-numeric: tabular-nums; }
  .pg-score b { font-weight: 600; color: ${env.tint.ink}; font-size: ${(s.specText.sizePt + 3).toFixed(1)}pt; }
  .pg-tail { margin: 0 0 ${GAP_META_ROW}mm; color: ${color(s.specText.color)}; ${t(s.specText)} }
  .pg-tech { margin: 0 0 ${GAP_META_ROW}mm; }
  .pg-tech-row { display: flex; gap: 3mm; break-inside: avoid; }
  .pg-tech-row span { flex: 0 0 14mm; color: ${env.tint.inkSoft}; ${t(s.specText)} }
  .pg-tech-row p { margin: 0; color: ${env.tint.ink}; ${t(s.specText)} }
  .pg-folio { position: absolute; bottom: 0; right: 0; margin: 0; color: ${color(s.folio.color)};
    ${t(s.folio)} font-variant-numeric: tabular-nums; }
  .pg-chapter-page { padding-top: 62mm; }
  .cp-block { max-width: 120mm; }
  .cp-title { margin: 3mm 0 0; color: ${env.tint.ink}; ${t(s.chapterTitle)} }
  .cp-rule { width: 28mm; height: 0.4pt; background: ${env.tint.line}; margin: 7mm 0; }
  `;
}
