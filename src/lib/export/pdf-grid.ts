// src/lib/export/pdf-grid.ts
'use client';

/**
 * 0.6.0：把「一页 = 一张 12 列 × 24 行的积木画布」画进 PDF。
 *
 * 与 word-grid.ts 的关系是**同一份规划、两种画法**：
 *   - 规划完全交给 layout.ts 的 planLayoutPage —— 每个积木落在第几列第几行、
 *     字号该选到哪一档、内容会不会被截断，PDF 与 Word 因此绝不会各算一套；
 *   - 画法不同：Word 里没有绝对定位，只能拿无边框表格模拟网格；PDF 走的是
 *     Chromium 打印，于是这里直接 `position:absolute` + mm 定位，每个积木一个
 *     `.gitem`，位置就是用户摆的位置，导出时绝不重排。
 *
 * 三条硬规矩（与 layout.ts 一致）：
 *   1. **一页的高度必须正好等于版心高度** —— 高了会被顶到下一页、多印一张空白页；
 *   2. **不溢出**：字号已经按 FONT_LADDER 缩过一档，这里再按真实测量把文字
 *      预裁成「整句 + 省略号」，CSS 层不再靠 -webkit-line-clamp 硬裁。
 *      0.6.4 之前用 measureTextCm 估算行数再交给 clamp，英文长单词、窄栏一旦
 *      估少一行，那一行就被 overflow:hidden 直接切掉 —— 用户投诉的「文字被
 *      截断、下面看不到了」就是它；
 *   3. **图片不裁切**：图片块按格子 contain，永远放得下。
 */

import { formatCamera, formatExifLine } from '@/lib/image/exif';
import type { ExportSettings, Photo, PhotoAnalysis, Technique } from '@/types/domain';

import { planCanvasPage } from './canvas';
import { HEAD_FONT_CSS, bodyFontOption } from './bookStyle';
import { type ItemPlan } from './layout';
import { tidyParam } from './params';
import {
  PT_TO_MM,
  fitText,
  makeFont,
  measureHeightMm,
  normalizeText,
  preferredAlign,
  singleLineWidthMm,
  type FontSpec,
} from './text-measure';

/* -------------------------------- 常量 -------------------------------- */

/**
 * 页高安全余量（cm）。mm→px 换算与 LayoutUnit 取整可能让「正好等于版心」的盒子
 * 多半像素，一旦溢出就会被 break-inside:avoid 整个推到下一页，多印一张空白页
 * （本项目踩过多次）。0.2mm 肉眼看不出，足够吃掉这点误差。
 */
const PAGE_SAFE_CM = 0.02;

/**
 * 章头已经压在同一页顶端时（≤3 张的紧凑章）要给积木让出的高度（cm）。
 * 章号 10pt + 章名 17pt + 分隔线 + 6mm 下边距，实测约 3.4cm。
 */
export const GRID_HEADING_RESERVE_CM = 3.6;

/**
 * 0.8.5：画布上每个文字块左上角的小标签。
 * 一整页如果只有灰字，读者分不清哪一段是正文、哪一段是评分（用户原话
 * 「看不懂哪一块是哪一块」）。标题、照片、图注不加标签 —— 它们自己看得懂。
 */
const MODULE_LABEL: Partial<Record<string, string>> = {
  story: '正文',
  technique: '拍摄手法',
  params: '参数',
  exif: 'EXIF',
  score: '评分',
  advice: '建议',
  tags: '标签',
  mood: '氛围',
  alt: '无障碍',
};

/** `.gitem-text` 的内边距（mm）：0.4mm 上下 + 0.6mm 左右，写死在这里与 pdf.ts 的 CSS 对齐 */const BOX_PAD_X_MM = 1.2;
const BOX_PAD_Y_MM = 0.8;

const TECH_LABELS: { key: keyof Technique; label: string }[] = [
  { key: 'composition', label: '构图' },
  { key: 'lighting', label: '光线' },
  { key: 'color', label: '色彩' },
  { key: 'lens', label: '镜头' },
  { key: 'post', label: '后期' },
];

/* ------------------------------- 小工具 ------------------------------- */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** cm → `xx.xxmm`：统一两位小数，避免浮点误差累积成 261.0000001mm */
function mm(cm: number): string {
  return (Math.round(cm * 1000) / 100).toFixed(2) + 'mm';
}

/** 积木的内框（mm）：扣掉 `.gitem-text` 的内边距，测量与渲染用同一个尺寸 */
function innerWidthMm(widthCm: number): number {
  return Math.max(4, widthCm * 10 - BOX_PAD_X_MM);
}

function innerHeightMm(heightCm: number): number {
  return Math.max(2, heightCm * 10 - BOX_PAD_Y_MM);
}

/** 图注文案：与 pdf.ts 竖排版保持同一口径（只有标题/参数，不带编号） */
function captionLine(a: PhotoAnalysis | undefined, settings: ExportSettings, index: number): string {
  void index;
  const capStyle = settings.captionStyle ?? 'title';
  const paramLine = a?.params
    ? [
        tidyParam(a.params.shutter, 'shutter'),
        tidyParam(a.params.aperture, 'aperture'),
        tidyParam(a.params.iso, 'iso'),
        tidyParam(a.params.focalLength, 'focal'),
      ]
        .filter((v) => v)
        .map((v) => escapeHtml(v))
        .join('\u00a0· ')
    : '';
  const capTitle = escapeHtml((a?.title || '').trim());
  const parts =
    capStyle === 'param' ? [paramLine] : capStyle === 'both' ? [capTitle, paramLine] : [capTitle || paramLine];
  const text = parts.filter((v) => v).join('\u00a0· ');
  // 行首一道破折线：图注比正文小一号、再压一道线，层级才分得开（与竖排版一致）
  // 0.8.4：去掉「— 图 01 · 」前缀 —— 标题已经印在图上方，再挂编号就是用户说的
  // 「照片旁边那个没必要的小数字」。
  return text ? `—\u00a0${text}` : '';
}

/**
 * 评分卡。宽格子照旧画进度条；窄格子（<9cm）改成「总分 + 几行小字」——
 * 24pt 的总分加两列进度条挤进 5cm 会把数字拆成竖排（Word 侧同样处理）。
 */
function scoreHtml(score: NonNullable<PhotoAnalysis['score']>, widthCm: number, pt: number, maxHeightMm: number): string {
  const b = score.breakdown;
  const dims: [string, number][] = [
    ['构图', b.composition],
    ['光线', b.lighting],
    ['调色', b.color],
    ['主体', b.subject],
    ['时机', b.timing],
    ['技术', b.technique],
  ];
  // `.module` 的上下 padding 1.2mm + 1px 边框：模块本身还要吃掉这些高度
  const modulePadMm = 2.4 + 0.53;
  const room = maxHeightMm - modulePadMm;

  const compact = (): string => {
    const perLine = widthCm >= 6.5 ? 3 : 2;
    const lines: string[] = [];
    for (let i = 0; i < dims.length; i += perLine) {
      lines.push(
        dims
          .slice(i, i + perLine)
          .map(([label, value]) => `${label} ${Number(value).toFixed(0)}`)
          .join('\u00a0· '),
      );
    }
    // 总分 2.2em（行高 1）+ 每行 0.9em（行高 1.45）+ 0.4mm 行距；放不下就从后往前丢
    const numH = 2.2 * pt * PT_TO_MM;
    const lineH = 0.9 * pt * 1.45 * PT_TO_MM + 0.4;
    const keep = Math.max(0, Math.min(lines.length, Math.floor((room - numH) / lineH)));
    if (keep <= 0) return '';
    return `<div class="module score compact">
        <div class="score-num">${score.overall.toFixed(1)}<small>/100</small></div>
        ${lines
          .slice(0, keep)
          .map((line) => `<p class="gscore-line">${line}</p>`)
          .join('')}
      </div>`;
  };

  if (widthCm < 9) return compact();

  // 宽格子：总分 + 两列进度条。0.85em、行高 1.3、两行 gap 0.4mm
  const barH = 0.85 * pt * 1.3 * PT_TO_MM;
  const gridH = 3 * barH + 2 * 0.4;
  if (gridH > room) return compact();

  const bars = dims
    .map(
      ([label, value]) =>
        `<div class="bar"><span>${label}</span><i><em style="width:${Math.min(100, value)}%"></em></i><u>${value.toFixed(1)}</u></div>`,
    )
    .join('');
  return `<div class="module score">
      <div class="score-num">${score.overall.toFixed(1)}<small>/100</small></div>
      <div class="score-grid">${bars}</div>
    </div>`;
}

/* ---------------------------- 每个积木画什么 ---------------------------- */

interface ItemContext {
  photo: Photo;
  index: number;
  settings: ExportSettings;
  dataUrl: string | null;
  analysis: PhotoAnalysis | undefined;
  /** 正文字体栈（与 pdf.ts 的 env.serifCss 同一份） */
  serif: string;
  /** 标题字体栈 */
  sans: string;
}

/** 纯文字段落：精确测量 → 必要时按整句缩短 → 返回可安全排进框里的文本 */
function paragraph(
  raw: string,
  widthMm: number,
  heightMm: number,
  font: FontSpec,
  opts: { firstIndentEm?: number } = {},
): { text: string; trackingEm: number; lines: number } {
  const clean = normalizeText(raw);
  if (!clean || heightMm <= 0) return { text: '', trackingEm: 0, lines: 0 };
  const fit = fitText(clean, widthMm, heightMm, font, opts);
  if (!fit.lines) return { text: '', trackingEm: 0, lines: 0 };
  return { text: fit.text, trackingEm: fit.trackingEm, lines: fit.lines };
}

/**
 * 这一段该两端对齐还是左对齐 —— 口径放在 text-measure 里（两套引擎共用）。
 *
 * `data-lines` 是我们测量出来的行数，只给验收脚本用：拿它和浏览器真实排出来的行数
 * 一比，就知道测量和 Chromium 的断行是否一致（不一致迟早会算少一行被切）。
 */
function paragraphHtml(
  cls: string,
  raw: string,
  widthMm: number,
  heightMm: number,
  font: FontSpec,
  ratio: number,
  opts: { firstIndentEm?: number; align?: 'justify' | 'left' } = {},
): string {
  const { text, trackingEm, lines } = paragraph(raw, widthMm, heightMm, font, opts);
  if (!text) return '';
  const track = trackingEm !== 0 ? `;letter-spacing:${trackingEm}em` : '';
  // 字号直接写死成测量时用的磅值：`.gitem` 的 font-size 是规划字号，而图注要小一号，
  // 只靠 CSS 的 em 换算会出现「按 8.5pt 量、按 9.5pt 印」——量少一行就溢出。
  const style = [`line-height:${ratio}`, `font-size:${font.sizePt.toFixed(2)}pt`];
  if (opts.align) style.push(`text-align:${opts.align}`);
  return `<p class="${cls}" data-lines="${lines}" style="${style.join(';')}${track}">${escapeHtml(text)}</p>`;
}

/** 拍摄手法：整行测量，装不下从后往前整行丢；最后一行允许按整句缩短 */
function techniqueRows(
  technique: Technique,
  pt: number,
  widthMm: number,
  heightMm: number,
  serif: string,
): { label: string; text: string }[] {
  const font = makeFont(serif, pt, pt * 1.5);
  const textWidth = Math.max(6, widthMm - 2.6 * pt * PT_TO_MM - 1.5);
  const lineH = font.linePt * PT_TO_MM;
  const rowGap = 0.5;
  const present = TECH_LABELS.filter(({ key }) => String(technique[key] ?? '').trim().length > 0).map(
    ({ key, label }) => ({ label, text: normalizeText(String(technique[key])) }),
  );

  const out: { label: string; text: string }[] = [];
  let used = 0;
  for (const row of present) {
    const need = measureHeightMm(row.text, textWidth, font) + rowGap;
    if (used + need <= heightMm) {
      out.push(row);
      used += need;
      continue;
    }
    const room = heightMm - used - rowGap;
    if (room >= lineH) {
      const fit = fitText(row.text, textWidth, room, font);
      if (fit.lines > 0) out.push({ label: row.label, text: fit.text });
    }
    break;
  }
  return out;
}

/** 参数胶囊：按行贪心，装不下丢尾部（宁可少一个胶囊，也不让最后一行被切） */
function chipsHtml(params: NonNullable<PhotoAnalysis['params']>, pt: number, widthMm: number, heightMm: number, serif: string): string {
  const font = makeFont(serif, pt, pt * 1.35);
  const chipPadMm = 2 * 1.2 + 2 * 0.265; // 左右 padding + 1px 边框
  const chipH = font.linePt * PT_TO_MM + 0.6 + 0.53;
  const gapMm = 1.2;
  const items = [
    ['焦段', tidyParam(params.focalLength, 'focal')],
    ['光圈', tidyParam(params.aperture, 'aperture')],
    ['快门', tidyParam(params.shutter, 'shutter')],
    ['ISO', tidyParam(params.iso, 'iso')],
    ['调色', tidyParam(params.colorGrade, 'color')],
  ].filter(([, v]) => v && v.trim()) as [string, string][];

  const kept: [string, string][] = [];
  let rowW = 0;
  let rows = 1;
  for (const [k, v] of items) {
    const cw = singleLineWidthMm(`${k}${v}`, font) + chipPadMm;
    if (rowW > 0 && rowW + gapMm + cw > widthMm) {
      rows += 1;
      rowW = 0;
    }
    rowW += (rowW > 0 ? gapMm : 0) + cw;
    if (rows * (chipH + gapMm) > heightMm) break;
    kept.push([k, v]);
  }
  if (kept.length === 0) return '';
  return `<div class="chips">${kept
    .map(([k, v]) => `<span class="chip"><b>${k}</b>${escapeHtml(v)}</span>`)
    .join('')}</div>`;
}

/** 三张要点卡：先按格子宽度算列数，再逐行塞，超了先丢行、后丢卡 */
function adviceHtml(a: PhotoAnalysis, pt: number, widthMm: number, heightMm: number, serif: string): string {
  const gap = 1.2;
  const cols = Math.max(1, Math.floor((widthMm + gap) / (42 + gap)));
  const colW = (widthMm - (cols - 1) * gap) / cols;
  const contentW = Math.max(8, colW - 2.8 - 0.53);
  const titleFont = makeFont(serif, pt * 0.85, pt * 0.85 * 1.35);
  const lineFont = makeFont(serif, pt, pt * 1.5);
  const titleH = titleFont.linePt * PT_TO_MM + 0.5;
  const padV = 2 + 0.53;

  const groups: [string, string[]][] = [
    ['为什么好看', a.whyGood ?? []],
    ['可以更好', a.improve ?? []],
    ['下次这样拍', a.imitate ?? []],
  ];

  type Card = { label: string; lines: { text: string; w: number }[] };
  const cards: Card[] = groups
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({
      label,
      lines: list.map((t) => {
        const text = normalizeText(t);
        return { text, w: measureHeightMm(`· ${text}`, contentW, lineFont) };
      }),
    }));
  if (cards.length === 0) return '';

  const cardH = (c: Card): number =>
    padV + titleH + c.lines.reduce((sum, l) => sum + l.w, 0);
  const totalH = (): number => {
    let h = 0;
    for (let r = 0; r * cols < cards.length; r += 1) {
      const row = cards.slice(r * cols, r * cols + cols);
      h += Math.max(...row.map(cardH)) + (r > 0 ? gap : 0);
    }
    return h;
  };

  // 超了：从最后一张卡的最后一行开始丢（整条丢，不切半行）
  while (totalH() > heightMm) {
    const last = cards[cards.length - 1];
    if (last.lines.length > 0) last.lines.pop();
    else if (cards.length > 1) cards.pop();
    else break;
  }
  if (cards.length === 0 || cards.every((c) => c.lines.length === 0)) return '';

  const html = cards
    .filter((c) => c.lines.length > 0)
    .map(
      (c) =>
        `<div class="card"><p class="card-title">${c.label}</p>${c.lines
          .map((l) => `<p class="card-line">· ${escapeHtml(l.text)}</p>`)
          .join('')}</div>`,
    )
    .join('');
  return html ? `<div class="advice">${html}</div>` : '';
}

function blockInner(plan: ItemPlan, pt: number, ctx: ItemContext): string {
  const { item, widthCm, heightCm } = plan;
  const a = ctx.analysis;
  const innerW = innerWidthMm(widthCm);
  const innerH = innerHeightMm(heightCm);

  switch (item.id) {
    case 'index':
      // 0.8.4：序号整个去掉（用户原话「照片左上角还有小数字，就是那个张数，我也不需要」）。
      // 排版台里如果还摆着「序号」积木，导出时当空块处理，不占位、不留白。
      return '';

    case 'title': {
      const raw = (a?.title || ctx.photo.fileName || '').trim();
      // h2：1.45em / 行高 1.25 / 无衬线 / 字重 600 / 字距 0.02em
      const font = makeFont(ctx.sans, pt * 1.45, pt * 1.45 * 1.25, 600, 0.02);
      const { text, trackingEm } = paragraph(raw, innerW, innerH, font);
      if (!text) return '';
      const track = trackingEm !== 0 ? `;letter-spacing:${trackingEm}em` : '';
      // 字号同样写死（= 1.45 × 规划字号），不让 CSS 的 em 换算决定最终磅值
      return `<h2 style="line-height:1.25;font-size:${(pt * 1.45).toFixed(2)}pt${track}">${escapeHtml(text)}</h2>`;
    }

    case 'image':
      // 拿不到图（读取失败）时留一个浅色占位框，而不是让整块消失、版面上开个洞
      return ctx.dataUrl
        ? `<figure><img src="${ctx.dataUrl}" alt="${escapeHtml(a?.title || ctx.photo.fileName)}"></figure>`
        : '<div class="gph"></div>';

    case 'caption': {
      const text = captionLine(a, ctx.settings, ctx.index);
      if (!text) return '';
      // 图注比正文小一号、行距松一点，和正文拉开层级
      return paragraphHtml('cap', text, innerW, innerH, makeFont(ctx.serif, pt, pt * 1.45), 1.45);
    }

    case 'story': {
      const raw = (a?.story ?? '').trim();
      if (!raw) return '';
      // 正文：首行缩进 2em，行高 1.65（与 CSS 完全一致）；
      // 西文段落不缩进、也不两端对齐（窄栏里会拉出词间大洞）
      const align = preferredAlign(raw);
      return paragraphHtml('story', raw, innerW, innerH, makeFont(ctx.serif, pt, pt * 1.65), 1.65, {
        // 首行缩进 2em 与 .gitem .story 的 CSS 一致；测量时也按缩进后的宽度算，
        // 否则「量的时候不缩、画的时候缩」会让行数少算一行、末行掉出格子。
        firstIndentEm: 2,
        align,
      });
    }

    case 'technique': {
      if (!a) return '';
      const rows = techniqueRows(a.technique, pt, innerW, innerH, ctx.serif);
      if (rows.length === 0) return '';
      return `<div class="techs">${rows
        .map((r) => `<div class="tech"><span>${r.label}</span><p>${escapeHtml(r.text)}</p></div>`)
        .join('')}</div>`;
    }

    case 'exif': {
      const exif = ctx.photo.exif;
      if (!exif) return '';
      const stamp = exif.takenAt ? new Date(exif.takenAt).toLocaleString('zh-CN', { hour12: false }) : '';
      const text = [formatCamera(exif), formatExifLine(exif), stamp].filter(Boolean).join('\u00a0·　');
      if (!text) return '';
      return paragraphHtml('exif', text, innerW, innerH, makeFont(ctx.serif, pt, pt * 1.5), 1.5);
    }

    case 'params': {
      const params = a?.params;
      if (!params) return '';
      return chipsHtml(params, pt, innerW, innerH, ctx.serif);
    }

    case 'score':
      return a?.score ? scoreHtml(a.score, widthCm, pt, innerH) : '';

    case 'advice':
      return a ? adviceHtml(a, pt, innerW, innerH, ctx.serif) : '';

    case 'category': {
      const category = a?.tags?.[0]?.trim() || a?.mood?.trim() || '';
      if (!category) return '';
      return paragraphHtml('category', `类别：${category}`, innerW, innerH, makeFont(ctx.serif, pt, pt * 1.5), 1.5);
    }

    case 'tags': {
      if (!a || a.tags.length === 0) return '';
      const text = a.tags.map((tag) => '#' + tag).join('　');
      // 标签常常四五个挤在一行，按正文同号会只剩「#城市天际线 #光…」。
      // 这里降一号再量，尽量多留住几个词（画布里这一格只有一行高，装不下两行）。
      const tagPt = Math.max(7.5, pt - 1);
      return paragraphHtml('tags', text, innerW, innerH, makeFont(ctx.serif, tagPt, tagPt * 1.55), 1.55);
    }

    case 'mood': {
      if (!a?.mood) return '';
      return paragraphHtml('mood', `氛围：${a.mood}`, innerW, innerH, makeFont(ctx.serif, pt, pt * 1.5), 1.5);
    }

    case 'alt': {
      const raw = (a?.alt ?? '').trim();
      if (!raw) return '';
      return paragraphHtml('alt', `无障碍：${raw}`, innerW, innerH, makeFont(ctx.serif, pt, pt * 1.5), 1.5);
    }

    default:
      return '';
  }
}

/* -------------------------------- 整页 -------------------------------- */

export interface GridPageParams {
  photo: Photo;
  index: number;
  dataUrl: string | null;
  settings: ExportSettings;
  /** 版心宽（cm） */
  contentCm: number;
  /** 版心高（cm）—— @page 边距算出来的可用高度 */
  contentHeightCm: number;
  /** 这一页顶端已经压着章头时，给它让出的高度（cm） */
  reservedCm?: number;
  /**
   * 这一页是否另起一页（默认 true）。和竖排版 `photoSection(..., noBreak)` 同义：
   * 紧凑章头（`.chapter-inline`）已经排在同一页顶端时传 false。
   * 必须和 `.break { break-before: page }` 对齐，否则网格页会粘在封面/章节扉页后面。
   */
  breakBefore?: boolean;
  /** 照片原始宽高（px）：只用来算画幅比，决定照片在版面上能占多高 */
  imgW?: number;
  imgH?: number;
  /** 0.8.4：页码。竖排版那边每页右下角都有页码，积木页以前没有，翻到中间页码就断了 */
  pageNo?: number;
}
/**
 * 画一页积木版照片页。返回一段 `<section class="page gpage-sheet">` HTML。
 *
 * 0.8.4（第二轮重做）：几何**直接照抄排版台的画布** —— 12 列 × 24 行，每个块落在它自己的
 * 格子里（left/top/width/height 全部由 col/row/colSpan/rowSpan 乘出来）。
 * 上一轮把块重新「流式」排了一遍，结果用户在排版台里对好的位置全失效，
 * 这才是「我排版排出来的和真正出来的根本不是一个样子」的原因。
 */
export function buildGridPhotoPage(params: GridPageParams): string {
  const { photo, index, settings, dataUrl } = params;
  const reservedCm = Math.max(0, params.reservedCm ?? 0);
  // 扣掉章头高度，再留一点点安全余量：整页高度必须 ≤ 版心高度，否则多印一张空白页
  const pageHeightCm = Math.max(6, params.contentHeightCm - reservedCm - PAGE_SAFE_CM);
  const aspect =
    params.imgW && params.imgH && params.imgW > 0 && params.imgH > 0
      ? params.imgW / params.imgH
      : photo.width > 0 && photo.height > 0
        ? photo.width / photo.height
        : 3 / 2;

  const plan = planCanvasPage({
    photo,
    settings,
    contentCm: params.contentCm,
    contentHeightCm: pageHeightCm,
    aspect,
  });

  const ctx: ItemContext = {
    photo,
    index,
    settings,
    dataUrl,
    analysis: photo.status === 'success' ? photo.analysis : undefined,
    serif: bodyFontOption(settings.bodyFont).css,
    sans: HEAD_FONT_CSS,
  };

  const cellsHtml = plan.cells
    .map((cell) => {
      const fig = cell.id === 'image';
      const pt = fig ? 0 : cell.fontPt;
      // 标签条（CSS 里的 padding-top 4.2mm）会吃掉格子里的高度，测量时要先让出来，
      // 否则文字按满格量、落进格子却少了 4mm，最后一行就被 overflow 切掉（clipped）。
      const label = fig ? '' : MODULE_LABEL[cell.id] ?? '';
      const labelRoom = label ? 0.5 : 0;
      const inner = blockInner(
        {
          item: { id: cell.id, col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          widthCm: Math.max(1, cell.widthCm - (label ? 0.32 : 0.12)),
          heightCm: Math.max(1, cell.heightCm - labelRoom),
          fontPt: fig ? 10.5 : cell.fontPt,
          needCm: cell.needCm,
          fits: true,
          truncated: false,
          shrunk: false,
        },
        pt,
        ctx,
      );
      if (!inner) return '';
      const box =
        `left:${mm(cell.leftCm)};top:${mm(cell.topCm)};` +
        `width:${mm(cell.widthCm)};height:${mm(cell.heightCm)}`;
      // 0.8.5：每个文字块挂一个小标签（正文/评分/拍摄手法…）。0.8.4 之前整页全是
      // 同一套灰字，读者看不出哪一块是什么（用户：「感觉全部都杂乱排在一起」）。
      return `<div class="gitem ${fig ? 'gitem-fig' : 'gitem-text'}" data-block="${cell.id}"${
        label ? ` data-label="${label}"` : ''
      } style="${box}${fig ? '' : ';font-size:' + pt + 'pt'}">${inner}</div>`;
    })
    .filter(Boolean)
    .join('\n');

  // 高度写死成 mm：不靠内容撑开，一张照片页永远只占一页。
  // `break` 类沿用竖排版那套（.page.break { break-before: page }）：和上一个板块的
  // break-after 挨在一起时，CSS 分页会合并成一次强制分页，不会多出空白页。
  // 外面再包一层 .page —— 纸色要铺满整张纸（含页边距），内层 .gpage 只管版心。
  const breakClass = params.breakBefore === false ? '' : ' break';
  const radius =
    settings.photoRadius != null && settings.photoRadius > 0
      ? `--photo-radius:${settings.photoRadius}mm;`
      : '';
  return `
    <section class="page gpage-sheet${breakClass}" style="${radius}">
      <div class="gpage" style="width:${mm(params.contentCm)};height:${mm(pageHeightCm)}">
${cellsHtml}
${params.pageNo ? `<p class="pg-folio">${params.pageNo}</p>` : ''}
      </div>
    </section>`;
}
