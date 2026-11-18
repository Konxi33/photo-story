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
 *   2. **不溢出**：字号已经按 FONT_LADDER 缩过一档，这里再按 measureTextCm 做一次
 *      JS 侧截断，CSS 层再用 overflow:hidden / -webkit-line-clamp 兜底；
 *   3. **图片不裁切**：图片块按格子 contain，永远放得下。
 */

import { formatCamera, formatExifLine } from '@/lib/image/exif';
import type { ExportSettings, Photo, PhotoAnalysis, Technique } from '@/types/domain';

import { measureTextCm, planLayoutPage, type ItemPlan } from './layout';
import { tidyParam } from './params';

/* -------------------------------- 常量 -------------------------------- */

const PT_TO_CM = 0.03528;

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

const pad2 = (n: number) => String(n).padStart(2, '0');

const TECH_LABELS: { key: keyof Technique; label: string }[] = [
  { key: 'composition', label: '构图' },
  { key: 'lighting', label: '光线' },
  { key: 'color', label: '色彩' },
  { key: 'lens', label: '镜头' },
  { key: 'post', label: '后期' },
];

const EMPTY_TECHNIQUE: Technique = { composition: '', lighting: '', color: '', lens: '', post: '' };

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

function lineHCm(pt: number, ratio: number): number {
  return pt * PT_TO_CM * ratio;
}

/** 盒子里最多能排几行（向下取整：多一行就是溢出） */
function maxLines(heightCm: number, pt: number, ratio = 1.6): number {
  return Math.max(1, Math.floor(heightCm / Math.max(0.1, lineHCm(pt, ratio))));
}

/** CSS 兜底层：按行数硬裁，行高同时写死，保证 JS 截断和实际渲染同一口径 */
function clampStyle(lines: number, ratio = 1.6): string {
  return `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};overflow:hidden;line-height:${ratio}`;
}

/** 把文字裁到指定高度内（末尾补省略号）：格子是固定的，宁可少印几个字也不溢出 */
function fitText(text: string, widthCm: number, maxCm: number, pt: number, lineRatio = 1.6): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || maxCm <= 0) return '';
  if (measureTextCm(clean, widthCm, pt, lineRatio).needCm <= maxCm) return clean;

  let length = clean.length;
  while (length > 6) {
    length = Math.floor(length * 0.9);
    const cut = clean.slice(0, length).trimEnd() + '…';
    if (measureTextCm(cut, widthCm, pt, lineRatio).needCm <= maxCm) return cut;
  }
  return clean.slice(0, 6) + '…';
}

/** 拍摄手法五行：从后往前丢，直到高度够 */
function fitTechnique(technique: Technique, widthCm: number, maxCm: number, pt: number): Technique {
  const present = TECH_LABELS.filter(({ key }) => String(technique[key] ?? '').trim().length > 0);
  for (let keep = present.length; keep > 0; keep -= 1) {
    const allowed = present.slice(0, keep);
    const text = allowed.map(({ key }) => String(technique[key]).trim()).join(' ');
    const need = Math.max(keep * lineHCm(pt, 1.6), measureTextCm(text, widthCm, pt, 1.55).needCm);
    if (need + 0.4 <= maxCm) {
      const next: Technique = { ...EMPTY_TECHNIQUE };
      allowed.forEach(({ key }) => {
        next[key] = String(technique[key]);
      });
      return next;
    }
  }
  return { ...EMPTY_TECHNIQUE };
}

/** 一组要点按高度裁剪（三块建议各有自己的列表） */
function fitGroup(items: string[] | undefined, widthCm: number, maxCm: number, pt: number): string[] {
  if (!items || items.length === 0) return [];
  const kept: string[] = [];
  let used = 0;
  for (const item of items) {
    const need = measureTextCm(item, widthCm, pt, 1.5).needCm + 0.14;
    if (used + need > maxCm && kept.length > 0) break;
    kept.push(item);
    used += need;
  }
  return kept;
}

/** 图注文案：与 pdf.ts 竖排版保持同一口径（编号 + 标题/参数） */
function captionLine(a: PhotoAnalysis | undefined, settings: ExportSettings, index: number): string {
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
        .join(' · ')
    : '';
  const capTitle = escapeHtml((a?.title || '').trim());
  const parts =
    capStyle === 'param' ? [paramLine] : capStyle === 'both' ? [capTitle, paramLine] : [capTitle || paramLine];
  const text = parts.filter((v) => v).join(' · ');
  return text ? `图 ${pad2(index)} · ${text}` : '';
}

/**
 * 评分卡。宽格子照旧画进度条；窄格子（<9cm）改成「总分 + 几行小字」——
 * 24pt 的总分加两列进度条挤进 5cm 会把数字拆成竖排（Word 侧同样处理）。
 */
function scoreHtml(score: NonNullable<PhotoAnalysis['score']>, widthCm: number): string {
  const b = score.breakdown;
  const dims: [string, number][] = [
    ['构图', b.composition],
    ['光线', b.lighting],
    ['调色', b.color],
    ['主体', b.subject],
    ['时机', b.timing],
    ['技术', b.technique],
  ];

  if (widthCm < 9) {
    const perLine = widthCm >= 6.5 ? 3 : 2;
    const lines: string[] = [];
    for (let i = 0; i < dims.length; i += perLine) {
      lines.push(
        dims
          .slice(i, i + perLine)
          .map(([label, value]) => `${label} ${Number(value).toFixed(0)}`)
          .join(' · '),
      );
    }
    return `<div class="module score compact">
        <div class="score-num">${score.overall.toFixed(1)}<small>/100</small></div>
        ${lines.map((line) => `<p class="gscore-line">${line}</p>`).join('')}
      </div>`;
  }

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
}

/**
 * 渲染字号：规划算出的 fontPt 是「这盒子能放下的最大字号」，
 * 标题要比正文大一档、图注/标签这些辅助信息要压到 8.5~9.5pt（与 blockNeedCm 一致）。
 */
function renderPt(id: ItemPlan['item']['id'], planPt: number): number {
  switch (id) {
    case 'title':
      return Math.min(planPt + 4, 16);
    case 'caption':
      return Math.min(planPt, 8.5);
    case 'tags':
      return Math.min(planPt, 9.5);
    case 'alt':
      return Math.min(planPt, 9);
    case 'index':
      return Math.min(planPt, 10);
    default:
      return planPt;
  }
}

function blockInner(plan: ItemPlan, pt: number, ctx: ItemContext): string {
  const { item, widthCm, heightCm, truncated } = plan;
  const a = ctx.analysis;
  const innerWidthCm = Math.max(1, widthCm - 0.2);

  switch (item.id) {
    case 'index':
      return `<p class="idx">${pad2(ctx.index)}</p>`;

    case 'title': {
      const raw = a?.title || ctx.photo.fileName;
      const text = truncated ? fitText(raw, innerWidthCm, heightCm - 0.1, pt, 1.3) : raw;
      return `<h2>${escapeHtml(text)}</h2>`;
    }

    case 'image':
      // 拿不到图（读取失败）时留一个浅色占位框，而不是让整块消失、版面上开个洞
      return ctx.dataUrl
        ? `<figure><img src="${ctx.dataUrl}" alt="${escapeHtml(a?.title || ctx.photo.fileName)}"></figure>`
        : '<div class="gph"></div>';

    case 'caption': {
      const text = captionLine(a, ctx.settings, ctx.index);
      if (!text) return '';
      return `<p class="cap" style="${clampStyle(maxLines(heightCm - 0.1, pt, 1.45), 1.45)}">${text}</p>`;
    }

    case 'story': {
      const raw = (a?.story ?? '').trim();
      if (!raw) return '';
      const room = heightCm - 0.25;
      const text = truncated ? fitText(raw, innerWidthCm, room, pt, 1.65) : raw;
      return `<p class="story" style="${clampStyle(maxLines(room, pt, 1.65), 1.65)}">${escapeHtml(text)}</p>`;
    }

    case 'technique': {
      if (!a) return '';
      const technique = truncated ? fitTechnique(a.technique, widthCm, heightCm, pt) : a.technique;
      const rows = TECH_LABELS.filter(({ key }) => String(technique[key] ?? '').trim().length > 0)
        .map(
          ({ key, label }) =>
            `<div class="tech"><span>${label}</span><p>${escapeHtml(String(technique[key]).trim())}</p></div>`,
        )
        .join('');
      return rows ? `<div class="techs">${rows}</div>` : '';
    }

    case 'exif': {
      const exif = ctx.photo.exif;
      if (!exif) return '';
      const stamp = exif.takenAt
        ? new Date(exif.takenAt).toLocaleString('zh-CN', { hour12: false })
        : '';
      const text = [formatCamera(exif), formatExifLine(exif), stamp].filter(Boolean).join('　·　');
      if (!text) return '';
      return `<p class="exif" style="${clampStyle(maxLines(heightCm - 0.1, pt, 1.5), 1.5)}">${escapeHtml(text)}</p>`;
    }

    case 'params': {
      const params = a?.params;
      if (!params) return '';
      const chips = [
        ['焦段', tidyParam(params.focalLength, 'focal')],
        ['光圈', tidyParam(params.aperture, 'aperture')],
        ['快门', tidyParam(params.shutter, 'shutter')],
        ['ISO', tidyParam(params.iso, 'iso')],
        ['调色', tidyParam(params.colorGrade, 'color')],
      ]
        .filter(([, v]) => v && v.trim())
        .map(([k, v]) => `<span class="chip"><b>${k}</b>${escapeHtml(v)}</span>`)
        .join('');
      return chips ? `<div class="chips">${chips}</div>` : '';
    }

    case 'score':
      return a?.score ? scoreHtml(a.score, widthCm) : '';

    case 'advice': {
      if (!a) return '';
      const room = heightCm - 0.4;
      const groups: [string, string[]][] = [
        ['为什么好看', truncated ? fitGroup(a.whyGood, innerWidthCm, room, pt) : a.whyGood ?? []],
        ['可以更好', truncated ? fitGroup(a.improve, innerWidthCm, room, pt) : a.improve ?? []],
        ['下次这样拍', truncated ? fitGroup(a.imitate, innerWidthCm, room, pt) : a.imitate ?? []],
      ];
      const cards = groups
        .filter(([, list]) => list.length > 0)
        .map(
          ([label, list]) =>
            `<div class="card"><p class="card-title">${label}</p>${list
              .map((line) => `<p class="card-line">· ${escapeHtml(line)}</p>`)
              .join('')}</div>`,
        )
        .join('');
      return cards ? `<div class="advice">${cards}</div>` : '';
    }

    case 'category': {
      const category = a?.tags?.[0]?.trim() || a?.mood?.trim() || '';
      if (!category) return '';
      return `<p class="category" style="${clampStyle(maxLines(heightCm, pt, 1.5), 1.5)}">类别：${escapeHtml(category)}</p>`;
    }

    case 'tags': {
      if (!a || a.tags.length === 0) return '';
      const text = a.tags.map((tag) => '#' + escapeHtml(tag)).join('&nbsp;&nbsp;');
      return `<p class="tags" style="${clampStyle(maxLines(heightCm, pt, 1.6), 1.6)}">${text}</p>`;
    }

    case 'mood': {
      if (!a?.mood) return '';
      return `<p class="mood" style="${clampStyle(maxLines(heightCm, pt, 1.5), 1.5)}">氛围：${escapeHtml(a.mood)}</p>`;
    }

    case 'alt': {
      const raw = (a?.alt ?? '').trim();
      if (!raw) return '';
      const room = heightCm - 0.1;
      const text = truncated ? fitText(raw, innerWidthCm, room, pt, 1.5) : raw;
      return `<p class="alt" style="${clampStyle(maxLines(room, pt, 1.5), 1.5)}">无障碍：${escapeHtml(text)}</p>`;
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
}

/**
 * 画一页积木版照片页。返回一段 `<section class="page gpage">` HTML，
 * 调用方直接拼进 body。
 *
 * 只在这里出现一次 `planLayoutPage`：几何、字号、截断判定全听它的，
 * PDF / Word / 预览因此永远一致。
 */
export function buildGridPhotoPage(params: GridPageParams): string {
  const { photo, index, settings, dataUrl } = params;
  const reservedCm = Math.max(0, params.reservedCm ?? 0);
  // 扣掉章头高度，再留一点点安全余量：整页高度必须 ≤ 版心高度，否则多印一张空白页
  const pageHeightCm = Math.max(6, params.contentHeightCm - reservedCm - PAGE_SAFE_CM);

  const plan = planLayoutPage({
    photo,
    index,
    settings,
    contentCm: params.contentCm,
    contentHeightCm: pageHeightCm,
  });

  const ctx: ItemContext = {
    photo,
    index,
    settings,
    dataUrl,
    analysis: photo.status === 'success' ? photo.analysis : undefined,
  };

  const items = plan.items
    .map((itemPlan) => {
      const { item, widthCm, heightCm } = itemPlan;
      const pt = itemPlan.item.id === 'image' ? 0 : renderPt(item.id, itemPlan.fontPt);
      const leftCm = plan.colWCm * item.col;
      const topCm = plan.rowHCm * item.row;
      const kind = item.id === 'image' ? 'gitem-fig' : 'gitem-text';
      const style = [
        'position:absolute',
        `left:${mm(leftCm)}`,
        `top:${mm(topCm)}`,
        `width:${mm(widthCm)}`,
        `height:${mm(heightCm)}`,
        item.id === 'image' ? '' : `font-size:${pt}pt`,
      ]
        .filter(Boolean)
        .join(';');
      return `      <div class="gitem ${kind}" data-block="${item.id}" style="${style}">${blockInner(itemPlan, pt, ctx)}</div>`;
    })
    .join('\n');

  // 高度写死成 mm：不靠内容撑开，一张照片页永远只占一页。
  // `break` 类沿用竖排版那套（.page.break { break-before: page }）：和上一个板块的
  // break-after 挨在一起时，CSS 分页会合并成一次强制分页，不会多出空白页。
  const breakClass = params.breakBefore === false ? '' : ' break';
  return `
    <section class="page gpage${breakClass}" style="position:relative;width:${mm(params.contentCm)};height:${mm(pageHeightCm)}">
${items}
    </section>`;
}
