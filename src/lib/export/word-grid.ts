// src/lib/export/word-grid.ts
'use client';

/**
 * 0.6.0：把「一页 = 一张 12×24 的积木画布」画进 Word。
 *
 * 做法：整页就是一张**无边框、固定布局**的表格。
 *   - 每个积木占若干个单元格（colSpan/rowSpan），行高按 EXACT 精确给定；
 *   - docx 的 TableCell 支持 rowSpan/columnSpan，库会自动补
 *     `<w:vMerge w:val="continue"/>`（已实测：LibreOffice 渲染正确）；
 *   - 一行只在「从这里开始」的积木位置上给单元格，被上面跨下来的位置不传，
 *     库会按列位置自动插入续接格。
 *
 * 为什么要表格：Word 里没有绝对定位，段落流表达不了「图在左、文字在右、
 * 下面横过来一段」。去掉边框后，读者看不出表格存在。
 */

import {
  AlignmentType,
  BorderStyle,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  HeightRule,
  TableLayoutType,
  VerticalAlign,
  WidthType,
  type ITableCellOptions,
  LineRuleType,
  PageBreak,
} from 'docx';

import { WORD_COLORS, WORD_FONTS, toDocxColor } from '@/config/wordLayout';
import type { ExportSettings, Photo, PhotoAnalysis, Technique } from '@/types/domain';

import { type BlockContext, buildPhotoSection, renderBlock } from './body';
import { type PhotoBlockId, resolveBlocks } from './blocks';
import { layoutOrder } from './layout';
import { buildRunStyle } from './fonts';
import { renderFlatBlock } from './flat-blocks';
import { bodyFontOption, HEAD_FONT_WORD } from './bookStyle';
import { figureNumber, pageStyle, tidyReading, type TypeSpec } from './typography';

// 说明：网格页不需要显式分页（见 buildGridPhotoSection 里的注释），
// 所以这里不引 pageBreakParagraph。
import { type EncodedImage } from './image-encode';
import {
  measureTextCm,
  planLayoutPage,
  resolveLayout,
  type ItemPlan,
  type LayoutItem,
  type PageLayout,
} from './layout';

export interface GridSectionParams {
  photo: Photo;
  index: number;
  image: EncodedImage | null;
  settings: ExportSettings;
  /** 版心宽度（cm） */
  contentCm: number;
  /** 版心高度（cm） */
  contentHeightCm: number;
  /** 这一页要不要另起一页 */
  pageBreakBefore?: boolean;
  /** 页头（紧凑章头之类），画在积木表格上面 */
  heading?: (Paragraph | Table)[];
}

/** 单元格内边距 0，积木才能贴住格线 */
const CELL_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 };

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

/* ----------------------------- 文字裁剪 ----------------------------- */

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

const TECHNIQUE_KEYS: (keyof Technique)[] = ['composition', 'lighting', 'color', 'lens', 'post'];

/** 拍摄手法 5 条：从后往前丢，直到高度够 */
function fitTechnique(
  technique: Technique,
  widthCm: number,
  maxCm: number,
  pt: number,
): Technique | undefined {
  const present = TECHNIQUE_KEYS.filter((key) => String(technique[key] ?? '').trim().length > 0);
  for (let keep = present.length; keep > 0; keep -= 1) {
    const allowed = present.slice(0, keep);
    const text = allowed.map((key) => String(technique[key]).trim()).join(' ');
    const need = Math.max(keep * pt * 0.03528 * 1.6, measureTextCm(text, widthCm, pt, 1.55).needCm);
    if (need + 0.35 <= maxCm) {
      const next: Technique = { composition: '', lighting: '', color: '', lens: '', post: '' };
      allowed.forEach((key) => {
        next[key] = String(technique[key]);
      });
      return next;
    }
  }
  return undefined;
}

/** 三块建议按高度裁剪 */
function fitGroup(items: string[] | undefined, widthCm: number, maxCm: number, pt: number): string[] {
  if (!items || items.length === 0) return [];
  const kept: string[] = [];
  let used = 0;
  for (const item of items) {
    const need = measureTextCm(item, widthCm, pt, 1.5).needCm + 0.12;
    if (used + need > maxCm && kept.length > 0) break;
    kept.push(item);
    used += need;
  }
  return kept;
}

/** 按格子尺寸裁剪要印的内容（只处理文字类积木；图片自己 contain） */
function trimAnalysis(
  analysis: PhotoAnalysis | undefined,
  id: string,
  widthCm: number,
  heightCm: number,
): PhotoAnalysis | undefined {
  if (!analysis) return undefined;
  switch (id) {
    case 'story':
      return { ...analysis, story: fitText(analysis.story ?? '', widthCm, heightCm - 0.45, 10.5, 1.65) };
    case 'alt':
      return { ...analysis, alt: fitText(analysis.alt ?? '', widthCm, heightCm - 0.12, 9, 1.5) };
    case 'technique':
      return {
        ...analysis,
        technique: fitTechnique(analysis.technique, widthCm, heightCm - 0.12, 9.5) ?? {
          composition: '',
          lighting: '',
          color: '',
          lens: '',
          post: '',
        },
      };
    case 'advice':
      return {
        ...analysis,
        whyGood: fitGroup(analysis.whyGood, widthCm, heightCm - 0.35, 9),
        improve: fitGroup(analysis.improve, widthCm, heightCm - 0.35, 9),
        imitate: fitGroup(analysis.imitate, widthCm, heightCm - 0.35, 9),
      };
    default:
      return analysis;
  }
}

/* --------------------------- 单元格内容 --------------------------- */

/**
 * 窄格子里的评分卡。
 * 原来的评分卡是 4 列固定宽度的表格，塞进 5~6cm 的格子会把「82.4」拆成
 * 竖排一个字一行；这里改成两行的紧凑写法，小格子里反而更清楚。
 */
function compactScore(
  score: NonNullable<PhotoAnalysis['score']>,
  widthCm: number,
): Paragraph[] {
  const b = score.breakdown;
  const dims: [string, number][] = [
    ['构图', b.composition],
    ['光线', b.lighting],
    ['调色', b.color],
    ['主体', b.subject],
    ['时机', b.timing],
    ['技术', b.technique],
  ];
  const perLine = widthCm >= 7 ? 3 : 2;
  const lines: string[] = [];
  for (let i = 0; i < dims.length; i += perLine) {
    lines.push(
      dims
        .slice(i, i + perLine)
        .map(([label, value]) => `${label} ${Number(value).toFixed(0)}`)
        .join(' · '),
    );
  }

  const out: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 60, line: 300 },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.storyBody, { color: toDocxColor(WORD_COLORS.nearBlack) }),
          text: `总分 ${score.overall.toFixed(1)}`,
          bold: true,
        }),
        new TextRun({
          ...buildRunStyle(WORD_FONTS.caption, { color: toDocxColor(WORD_COLORS.lightGray) }),
          text: `  /100`,
        }),
      ],
    }),
  ];

  for (const line of lines) {
    out.push(
      new Paragraph({
        spacing: { before: 0, after: 0, line: 240 },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.caption, { color: toDocxColor(WORD_COLORS.midGray) }),
            text: line,
          }),
        ],
      }),
    );
  }
  return out;
}

function cellContent(plan: ItemPlan, params: GridSectionParams): (Paragraph | Table)[] {
  const { photo, image, settings } = params;
  const id = plan.item.id;
  const analysis = photo.status === 'success' ? photo.analysis : undefined;
  const trimmed = trimAnalysis(analysis, id, plan.widthCm, plan.heightCm);

  // 窄格子里的评分卡改用紧凑写法（表格版会把「82.4」拆成竖排）
  if (id === 'score' && plan.widthCm < 9 && analysis?.score) {
    return compactScore(analysis.score, plan.widthCm);
  }

  // 内容是否出现由画布决定，所以这里放开旧的布尔开关 ——
  // 否则「关掉 includeTechnique」的用户在画布上加回拍摄手法会被静默吞掉。
  const openSettings: ExportSettings = {
    ...settings,
    includeStory: true,
    includeTechnique: true,
    includeTags: true,
    includeMood: true,
    includeAlt: true,
    captionUnderImage: true,
  };

  const ctx: BlockContext = {
    photo,
    index: params.index,
    image,
    settings: openSettings,
    analysis: trimmed,
    contentCm: plan.widthCm,
    imageRoomCm: plan.heightCm,
    imageFrame: { widthCm: plan.widthCm, heightCm: plan.heightCm },
    sticky: false,
  };

  // 0.6.3：评分/建议/参数一律压成段落，格子内不再嵌表（Word 里嵌套表会把行高算错）
  const flat = renderFlatBlock({
    id,
    analysis: trimmed,
    widthCm: plan.widthCm,
    index: params.index,
  });
  if (flat && flat.length > 0) return flat;

  const out = renderBlock(id, ctx, {}, true);
  if (out.length === 0) {
    return [new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' }, children: [] })];
  }
  return out;
}

/* ------------------------------ 主体 ------------------------------ */

interface Occupied {
  [key: string]: true;
}

/**
 * 一页照片（积木版）。返回段落/表格序列，调用方直接塞进 section children。
 */
export function buildGridPhotoSection(params: GridSectionParams): (Paragraph | Table)[] {
  const { photo, index, settings, contentCm, contentHeightCm, heading, pageBreakBefore } = params;
  const layout: PageLayout = resolveLayout(settings);
  const plan = planLayoutPage({ photo, index, settings, contentCm, contentHeightCm });

  const out: (Paragraph | Table)[] = [];
  // 0.6.1：高度预算要把「同一页顶上的紧凑章头」和「表后那一小段空隙」都算进去。
  // 关键教训：LibreOffice / Word 里 `HeightRule.EXACT` **不会裁掉超出的内容**，
  // 单元格里的嵌套小表（拍摄参数、评分卡）一旦比格子高，整行就会长高，
  // 表格因此比页面高一点点 —— 最后那一行被挤到下一页，看起来就是一张白纸。
  // 所以宁可多留 2.6cm：少印两行字，也不能让每张照片后面跟一张白页。
  const headingCm = heading && heading.length > 0 ? 3.4 : 0;
  const heightCm = Math.max(6, contentHeightCm - 2.6 - headingCm);

  // 0.6.0 起不再插分页段落：网格页永远是 24 行、占满版心，下一张表自然顶到
  // 新的一页去。之前用「段落 + 分页符」，表格前后夹一个分页段落时
  // LibreOffice 会在每章之间多印一张空白页（实测 22 页渲成 39 页）。
  void pageBreakBefore;

  if (heading && heading.length > 0) out.push(...heading);

  const colTwips = Math.floor((contentCm * 567) / layout.cols);
  const rowTwips = Math.floor((heightCm * 567) / layout.rows);

  const byRow = new Map<number, ItemPlan[]>();
  for (const itemPlan of plan.items) {
    const row = itemPlan.item.row;
    const list = byRow.get(row) ?? [];
    list.push(itemPlan);
    byRow.set(row, list);
  }
  byRow.forEach((list) => list.sort((a, b) => a.item.col - b.item.col));

  const occupied: Occupied = {};
  const rows: TableRow[] = [];

  for (let row = 0; row < layout.rows; row += 1) {
    const cells: TableCell[] = [];
    const starting = byRow.get(row) ?? [];

    for (const itemPlan of starting) {
      const { col, colSpan, rowSpan } = itemPlan.item;
      const options: ITableCellOptions = {
        width: { size: colTwips * colSpan, type: WidthType.DXA },
        columnSpan: colSpan > 1 ? colSpan : undefined,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
        // 图片在格子里上下居中：竖长的格子里 3:2 的图上下留白均分，像装裱过的照片
        verticalAlign: itemPlan.item.id === 'image' ? VerticalAlign.CENTER : VerticalAlign.TOP,
        margins: CELL_MARGINS,
        children: cellContent(itemPlan, params),
      };
      cells.push(new TableCell(options));
      for (let r = row; r < Math.min(layout.rows, row + rowSpan); r += 1) {
        for (let c = col; c < Math.min(layout.cols, col + colSpan); c += 1) {
          occupied[`${r}:${c}`] = true;
        }
      }
    }

    // 兜底：没被任何积木覆盖的格子补空格子，保证每行单元格总数等于列数。
    let filler = 0;
    for (let col = 0; col < layout.cols; col += 1) {
      if (occupied[`${row}:${col}`]) continue;
      // 只有「本行没有积木从这里开始」时才补，跨行占用的列不补
      const coveredFromAbove = plan.items.some((itemPlan) => {
        const item = itemPlan.item;
        return item.col === col && item.row < row && item.row + item.rowSpan > row;
      });
      if (coveredFromAbove) {
        filler += 1;
        continue;
      }
      cells.push(
        new TableCell({
          width: { size: colTwips, type: WidthType.DXA },
          verticalAlign: VerticalAlign.TOP,
          margins: CELL_MARGINS,
          children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' }, children: [] })],
        }),
      );
    }
    void filler;

    rows.push(
      new TableRow({
        height: { value: rowTwips, rule: HeightRule.EXACT },
        cantSplit: true,
        children: cells,
      }),
    );
  }

  out.push(
    new Table({
      layout: TableLayoutType.FIXED,
      width: { size: Math.round(contentCm * 567), type: WidthType.DXA },
      borders: NO_BORDERS,
      rows,
    }),
  );

  return out;
}

/**
 * 没有网格设置时（老项目），走 0.5.7 的板块竖排。
 * document.ts 用它做兼容，避免两套逻辑分叉。
 */
export { buildPhotoSection };

/**
 * 0.6.3：Word 的「两栏流式」页。
 *
 * 为什么另起一条路：12×24 精确网格在 Chromium（PDF）里表现很好，但 Word 的表格
 * 行高有个脾气 —— HeightRule.EXACT 只影响行的「名义高度」，单元格里的文字或嵌套
 * 小表一高，整行照样长高，于是下一行的内容被推下去，视觉上就是「图片和表格跑位、
 * 字压在图片上」。
 *
 * 两栏流式没有这个问题：左栏（序号/标题/大图/图注/正文）与右栏（评分/建议/手法/
 * 参数/相机/类别/标签/氛围/无障碍）各是一个单元格，内容在里面自然往下排，
 * 谁高就谁高，绝不会互相压住，也不会跑出纸面。
 */
export interface FlowSectionParams {
  photo: Photo;
  index: number;
  image: EncodedImage | null;
  settings: ExportSettings;
  /** 版心宽（cm） */
  contentCm: number;
  /** 紧凑章头的段落：要和这一页的第一张同页 */
  heading?: (Paragraph | Table)[];
  /** 这一页是否另起一页 */
  pageBreakBefore?: boolean;
}

const FLOW_LEFT: PhotoBlockId[] = ['index', 'title', 'image', 'caption', 'story'];
const FLOW_RIGHT: PhotoBlockId[] = [
  'score',
  'advice',
  'technique',
  'params',
  'exif',
  'category',
  'tags',
  'mood',
  'alt',
];

export function buildFlowPhotoSection(params: FlowSectionParams): (Paragraph | Table)[] {
  const { photo, index, image, settings, contentCm } = params;
  const ids = resolveBlocks(settings);
  if (!ids.includes('image')) return [];

  const leftIds = FLOW_LEFT.filter((id) => ids.includes(id));
  const rightIds = FLOW_RIGHT.filter((id) => ids.includes(id));

  // 左右 8:4 —— 画册里最耐看的分栏，右栏只放「小字信息」
  const totalTwips = Math.round(contentCm * 567);
  const leftTwips = Math.round(totalTwips * 0.665);
  const rightTwips = totalTwips - leftTwips;
  const leftCm = (leftTwips / 567) * 0.96;
  const rightCm = (rightTwips / 567) * 0.96;

  // 板块清单本身决定印不印，旧布尔开关一律视为打开，
  // 免得出现「用户把某块拖上纸、但内容被开关吞掉」。
  const openSettings: ExportSettings = {
    ...settings,
    includeStory: true,
    includeTechnique: true,
    includeTags: true,
    includeMood: true,
    includeAlt: true,
    includeScoreDetail: true,
    captionUnderImage: true,
  };

  const mkCtx = (widthCm: number, imageRowsCm: number): BlockContext => ({
    photo,
    index,
    image,
    settings: openSettings,
    analysis: photo.status === 'success' ? photo.analysis : undefined,
    contentCm: widthCm,
    imageRoomCm: imageRowsCm,
    imageFrame: { widthCm, heightCm: imageRowsCm },
    sticky: false,
  });

  const render = (
    list: PhotoBlockId[],
    widthCm: number,
    imageRowsCm: number,
    lead: boolean,
  ): (Paragraph | Table)[] => {
    const ctx = mkCtx(widthCm, imageRowsCm);
    const out: (Paragraph | Table)[] = [];
    list.forEach((id, i) => {
      const isFirst = i === 0;
      const isTail = i === list.length - 1;
      const flat = renderFlatBlock({ id, analysis: ctx.analysis, widthCm, index });
      if (flat && flat.length > 0) {
        out.push(...flat);
        return;
      }
      out.push(...renderBlock(id, ctx, { pageBreakBefore: lead && isFirst }, isTail && !lead));
    });
    return out;
  };

  // 图框高度按「版心高 - 下方文字」估算：留 11cm 给正文和图注
  const imageHeightCm = Math.max(7, Math.min(13, 25.2 - 11.5));

  const leftCell = new TableCell({
    width: { size: leftTwips, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 0, right: 220 },
    children: render(leftIds, leftCm, imageHeightCm, Boolean(params.pageBreakBefore)),
  });
  const rightCell = new TableCell({
    width: { size: rightTwips, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 200, right: 0 },
    children:
      rightIds.length > 0
        ? render(rightIds, rightCm, imageHeightCm, false)
        : [new Paragraph({ text: '' })],
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [new TableRow({ cantSplit: true, children: [leftCell, rightCell] })],
  });

  const out: (Paragraph | Table)[] = [];
  if (params.heading && params.heading.length > 0) out.push(...params.heading);
  out.push(table);
  return out;
}

export interface SingleFlowParams {
  photo: Photo;
  index: number;
  image: EncodedImage;
  settings: ExportSettings;
  contentCm: number;
  contentHeightCm: number;
  heading?: (Paragraph | Table)[];
  pageBreakBefore?: boolean;
}

/**
 * 0.6.3：Word 的「单栏流式」版面 —— 纯段落，零嵌套表、零固定行高。
 *
 * 为什么最终选了它：Word/LibreOffice 里 `HeightRule.EXACT` 不裁内容，
 * 单元格里再嵌小表（评分/建议/参数）会让整行失真，渲染出来就是字压字；
 * 而 12×24 网格在 A4 上为了塞下 14 个板块，行高被压到 1cm 上下，
 * 中文正文一换行就顶出去。单栏流式没有这些问题：段落自然往下排，
 * 排满一页就翻页，永远不会重叠、不会裁切。
 *
 * 用户自定义的「顺序」仍然被尊重（用 layoutOrder 决定板块先后），
 * 只是「格子位置」在 Word 里让位给可读性；PDF 走的是排版台的绝对坐标。
 */
export function buildSingleFlowSection(params: SingleFlowParams): (Paragraph | Table)[] {
  const { photo, index, image, settings, contentCm, contentHeightCm } = params;
  const analysis = photo.analysis;
  if (!analysis) return [];

  const openSettings = { ...settings, useGrid: false } as ExportSettings;
  const order = layoutOrder(resolveLayout(settings));
  let ids: PhotoBlockId[] = order.filter((id) => id !== 'image');
  const out: (Paragraph | Table)[] = [];

  // 0.6.4：字号层级不再各写一套，统一从 typography 的令牌取 —— 与 PDF 同源，
  // 屏幕上是什么样，纸上就是什么样。
  const style = pageStyle(settings.pageStyle);
  const bodyFont = bodyFontOption(settings.bodyFont).word;
  const headFont = HEAD_FONT_WORD;
  const inkColor = (spec: TypeSpec): string =>
    spec.color === 'soft'
      ? toDocxColor(WORD_COLORS.midGray)
      : spec.color === 'accent'
        ? '#8A5A3B'
        : toDocxColor(WORD_COLORS.nearBlack);
  const run = (spec: TypeSpec, text: string, font = bodyFont) =>
    new TextRun({
      font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: font, hint: 'eastAsia' },
      size: Math.round(spec.sizePt * 2),
      bold: spec.weight >= 600,
      color: inkColor(spec),
      text,
    });
  const mmPt = (mm: number): number => Math.round(mm * 2.8346);

  if (params.heading && params.heading.length > 0) out.push(...params.heading);

  const headingCm =
    params.heading && params.heading.length > 0 ? (params.heading.length === 1 ? 1.9 : 5.0) : 0;
  const widthCm = Math.min(contentCm, 14.6);

  // 图能占多高，得先算清文字要占多少 —— 否则一张照片连同文字会溢到第二页，
  // 正是用户说的「图和字分到两页」。这里按字数估行数（中文 1em、西文 0.55em）。
  const innerCm = contentCm - 0.5;
  const need = (text: string | undefined, pt: number, ratio = 1.7): number => {
    if (!text || !text.trim()) return 0;
    // 1.06 是实测校准系数：比 LibreOffice 实际排出来的略高一点，宁可少放一块也不溢出
    return measureTextCm(text, innerCm, pt, ratio).needCm * 1.06;
  };
  const adviceText = [
    ...(analysis.whyGood ?? []),
    ...(analysis.improve ?? []),
    ...(analysis.imitate ?? []),
  ].join(' ');
  const techniqueText = [
    analysis.technique?.composition,
    analysis.technique?.lighting,
    analysis.technique?.color,
    analysis.technique?.lens,
    analysis.technique?.post,
  ]
    .filter(Boolean)
    .join(' ');
  const costOf = (id: PhotoBlockId): number => {
    if (id === 'story') return need(analysis.story, 10.5) + 0.7;
    if (id === 'score') return 2.4;
    if (id === 'advice') return adviceText.trim() ? need(adviceText, 9.5) + 2.4 : 0;
    if (id === 'technique') return techniqueText.trim() ? need(techniqueText, 9.5) + 1.2 : 0;
    if (id === 'params') return 0.95;
    if (id === 'exif') return 0.95;
    if (id === 'title') return 1.7;
    if (id === 'index') return 0.95;
    return 0.9;
  };
  // 一页装不下时按优先级让位：先砍「解读」类，正文与图永远保留
  // alt/mood/category 与图注、标签重复，最先让位；接着是解读类；正文和拍摄手法永远保留
  const DROP_ORDER: PhotoBlockId[] = [
    'alt',
    'mood',
    'category',
    'advice',
    'params',
    'exif',
    'tags',
    'score',
  ];
  const MIN_IMAGE = 6.2;
  let total = ids.reduce((sum, id) => sum + costOf(id), 0);
  // 0.6.4：先给照片定目标高度（约 46% 页高），再让文字去挤；文字挤不下才让照片让位。
  // 之前是「先算文字、剩下多少给照片」，结果文字估得一多，照片就被压成 6cm 的小图。
  let imageH = Math.min(15, Math.max(MIN_IMAGE, contentHeightCm * 0.6));
  const budget = (): number => contentHeightCm - total - headingCm - 2.2;
  for (const drop of DROP_ORDER) {
    if (budget() >= imageH) break;
    if (!ids.includes(drop)) continue;
    ids = ids.filter((id) => id !== drop);
    total -= costOf(drop);
  }
  while (budget() < imageH && imageH > MIN_IMAGE) {
    imageH = Math.max(MIN_IMAGE, imageH * 0.88);
  }
  const imageFrame = {
    widthCm,
    heightCm: Math.min(15, imageH),
  };

  const render = (id: PhotoBlockId) => {
    // 0.6.4：这几个块改用画册口径重写（左对齐、固定行距、无满宽分隔线），
    // 其余块仍走原来的 flat/块渲染器，避免一次性改动太大。
    if (id === 'title') {
      const text = (analysis.title || photo.fileName || '').trim();
      if (!text) return [];
      return [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          // 0.7.5：标题必须和下面的图片同页 —— 标题落在页底、图片跑到下一页是最难看的排版事故
          keepNext: true,
          spacing: {
            before: 0,
            after: mmPt(4),
            line: Math.round(style.pageTitle.linePt * 20),
            lineRule: LineRuleType.EXACT,
          },
          children: [run(style.pageTitle, text, headFont)],
        }),
      ];
    }
    if (id === 'index') {
      return [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          keepNext: true,
          spacing: { before: 0, after: mmPt(1.5), line: Math.round(style.captionNum.linePt * 20), lineRule: LineRuleType.EXACT },
          children: [run(style.captionNum, figureNumber(index + 1, style), headFont)],
        }),
      ];
    }
    if (id === 'caption') {
      const title = (analysis.title || photo.fileName || '').trim();
      if (!title) return [];
      // 标题已经印在图片正上方了，图注再印一遍同样的字就是重复 —— 只有标题被让位时才补图注
      if (ids.includes('title')) return [];
      // 图注：编号两位补零 + 全角空格 + 标题，不加冒号（跟 PDF 同一口径）
      return [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          keepLines: true,
          spacing: {
            before: mmPt(2.5),
            after: mmPt(1),
            line: Math.round(style.caption.linePt * 20),
            lineRule: LineRuleType.EXACT,
          },
          children: [
            run(style.captionNum, `${figureNumber(index + 1, style)}　`, headFont),
            run(style.caption, title),
          ],
        }),
      ];
    }
    if (id === 'story') {
      const text = tidyReading(analysis.story ?? '');
      if (!text) return [];
      return [
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: {
            before: mmPt(6),
            after: 0,
            line: Math.round(style.body.linePt * 20),
            lineRule: LineRuleType.EXACT,
          },
          indent: { firstLine: Math.round(style.body.sizePt * 2 * 20) },
          children: [run(style.body, text)],
        }),
      ];
    }

    const ctx: BlockContext = {
      photo,
      index,
      image,
      settings: openSettings,
      analysis,
      contentCm,
      imageRoomCm: imageFrame.heightCm,
      imageFrame,
      sticky: false,
    };
    const flat = renderFlatBlock({ id, analysis, widthCm: contentCm, index });
    if (flat && flat.length > 0) return flat;
    return renderBlock(id, ctx, {}, true);
  };

  // 标题组（序号 + 标题）紧随其后；在没有标题的版式里也别把图顶到最上面
  const beforeImage = ids.filter((id) => id === 'index' || id === 'title');
  for (const id of beforeImage) out.push(...render(id));

  // 图片始终排在标题之后、正文之前
  const imageCtx: BlockContext = {
    photo,
    index,
    image,
    settings: openSettings,
    analysis,
    contentCm,
    imageRoomCm: imageFrame.heightCm,
    imageFrame,
    sticky: false,
  };
  out.push(...renderBlock('image', imageCtx, {}, false));

  // 0.6.4：图注永远紧跟图片（原来按积木顺序排，图注被挤到「拍摄手法」后面去了）
  const rest = ids.filter((id) => id !== 'index' && id !== 'title');
  const capAt = rest.indexOf('caption');
  if (capAt > 0) {
    rest.splice(capAt, 1);
    rest.unshift('caption');
  }
  for (const id of rest) {
    out.push(...render(id));
  }
  // 有章头时，章头第一段自己带 pageBreakBefore；再塞一个分页段会多出整张白纸
  if (params.pageBreakBefore && (!params.heading || params.heading.length === 0)) {
    const first = out[0];
    if (first instanceof Paragraph) {
      // 段落只读，改成在 heading 之外再塞一个 1pt 分页段
      out.unshift(
        new Paragraph({
          spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
          children: [new PageBreak()],
        }),
      );
    }
  }

  return out;
}

/* ------------------------- 画布流式（0.6.6） ------------------------- */

/**
 * 0.6.6：在 Word 里把排版台的「位置」印出来，同时保证不叠字、不裁字。
 *
 * 为什么又要动它：0.6.3 的单栏流式（buildSingleFlowSection）只认板块**顺序**，
 * 用户在 12×24 画布上摆的「图在左、字在右」全被抹平 —— 这就是
 * 「我自己自定义的排版台去导出 word，它并不会生效」。
 * 但 0.6.1 的老网格页（EXACT 行高 + 单元格内嵌小表）会叠字，也不能退回去。
 *
 * 于是折中成「行带（band）」：
 *   1. 把 12×24 画布按所有块的 row / row+rowSpan 切成一列横缝；
 *   2. 往下扫，只要「列区间分布」没变（比如一直是「左 0–8 / 右 8–12」），
 *      这几条横缝就并成**一条行带**，同一列区间里上下叠着的块（右栏的评分、
 *      建议、手法）按 row 顺序在同一格里往下排；
 *   3. 每条行带画成**一张单行表**：单元格 = 列区间，列宽 = colSpan/12 × 版心宽；
 *      **不写行高、绝不用 HeightRule.EXACT、不锁 cantSplit** —— Word 想怎么长高
 *      就怎么长高，文字自然换行，宁可整页变长也绝不裁字；
 *   4. 图片只给宽度（imageFrame 高度给一个「无限大」），按单元格宽等比缩放。
 *
 * 与 0.6.1 网格版的区别就在第 3 步：那里行高被 EXACT 钉死，单元格里的内容一高
 * 就压住下一行；这里是「自然高度」，最多把页面撑长，永远不会重叠。
 */
export interface CanvasFlowParams {
  photo: Photo;
  index: number;
  image: EncodedImage | null;
  settings: ExportSettings;
  /** 版心宽度（cm） */
  contentCm: number;
  /** 页头（紧凑章头之类），画在第一条行带上面 */
  heading?: (Paragraph | Table)[];
  /** 这一页要不要另起一页 */
  pageBreakBefore?: boolean;
}

/** 画布流式不按格子高度裁字：给一个「无限高」，fitText/fitTechnique/fitGroup 就原样返回 */
const NO_CLIP_CM = 999;

/** 一段列区间：占哪几列、里面自上而下叠着哪些块 */
interface CanvasRange {
  col: number;
  span: number;
  ids: PhotoBlockId[];
}

/** 一条行带：若干条互不重叠的列区间 */
interface CanvasBand {
  ranges: CanvasRange[];
}

/** 一条行带里的一个单元格（filler = 用户没摆东西的空白列） */
interface CanvasCell {
  col: number;
  span: number;
  ids: PhotoBlockId[];
  filler: boolean;
}

/** 正文类块：窄于 4/12（约 5.5cm）时中文一行放不下几个字，要保底 */
const LONG_TEXT_IDS: PhotoBlockId[] = ['story', 'technique', 'advice', 'score', 'params', 'alt'];

/** 文字格的内边距（twips，108 ≈ 1.9mm）：让正文不贴着图片/表线 */
const CANVAS_GUTTER_TWIPS = 108;

function canvasFloorCols(cell: CanvasCell): number {
  if (cell.filler || cell.ids.length === 0) return 0;
  if (cell.ids.includes('image')) return 4;
  return Math.max(...cell.ids.map((id) => {
    if (id === 'index') return 1;
    if (LONG_TEXT_IDS.includes(id)) return 4;
    return 2;
  }));
}

const sameRanges = (a: CanvasRange[], b: CanvasRange[]): boolean =>
  a.length === b.length &&
  a.every((range, index) => range.col === b[index].col && range.span === b[index].span);

/**
 * 把画布切成行带。
 *
 * 切缝取所有块的 row 与 row+rowSpan（外加 0 和 rows）；相邻两条缝之间，
 * 覆盖它的块集合是稳定的 —— 这些块的列区间必然互不重叠（normalizeLayout
 * 已经去掉重叠的块），所以一条横缝天然就是「一行单元格」。
 * 若干条横缝的列区间分布完全一致时并成一条带，右栏竖着堆的块就落在同一格里。
 */
function canvasBands(items: LayoutItem[], rows: number): CanvasBand[] {
  const cuts = new Set<number>([0, rows]);
  for (const item of items) {
    cuts.add(Math.max(0, Math.min(rows, item.row)));
    cuts.add(Math.max(0, Math.min(rows, item.row + item.rowSpan)));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const slabs: CanvasRange[][] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const top = points[i];
    const bottom = points[i + 1];
    if (bottom <= top) continue;
    const active = items
      .filter((item) => item.row <= top && item.row + item.rowSpan >= bottom)
      .sort((a, b) => a.col - b.col);
    // 整段空白行（用户摆得比较松）：不占版面，反正 Word 靠段落间距
    if (active.length === 0) continue;
    slabs.push(active.map((item) => ({ col: item.col, span: item.colSpan, ids: [item.id] })));
  }

  const bands: CanvasBand[] = [];
  for (const slab of slabs) {
    const last = bands[bands.length - 1];
    if (last && sameRanges(last.ranges, slab)) {
      slab.forEach((range, index) => {
        for (const id of range.ids) {
          if (!last.ranges[index].ids.includes(id)) last.ranges[index].ids.push(id);
        }
      });
      continue;
    }
    bands.push({ ranges: slab.map((range) => ({ ...range, ids: [...range.ids] })) });
  }
  return bands;
}

/** 把一条行带补成「整 12 列」：左右和中间的空白列都补空单元格 */
function canvasCells(band: CanvasBand, cols: number): CanvasCell[] {
  const cells: CanvasCell[] = [];
  let cursor = 0;
  for (const range of band.ranges) {
    if (range.col > cursor) {
      cells.push({ col: cursor, span: range.col - cursor, ids: [], filler: true });
    }
    cells.push({ col: range.col, span: range.span, ids: range.ids, filler: false });
    cursor = range.col + range.span;
  }
  if (cursor < cols) {
    cells.push({ col: cursor, span: cols - cursor, ids: [], filler: true });
  }
  return cells;
}

/**
 * 最小宽度保底：某格窄于下限时，先从空白格匀（空白格压没了也不影响阅读），
 * 再从还有余量的格子里匀，**总和仍然是 cols（12）**，版面不会被撑宽。
 */
function balanceSpans(cells: CanvasCell[], cols: number): number[] {
  const spans = cells.map((cell) => Math.max(0, Math.min(cols, cell.span)));
  const floors = cells.map((cell) => canvasFloorCols(cell));
  for (let i = 0; i < spans.length; i += 1) {
    let need = floors[i] - spans[i];
    if (need <= 0) continue;
    const donors = spans
      .map((span, j) => ({ j, slack: cells[j].filler ? span : Math.max(0, span - floors[j]) }))
      .filter((donor) => donor.j !== i && donor.slack > 0)
      .sort((a, b) => b.slack - a.slack);
    for (const donor of donors) {
      if (need <= 0) break;
      const take = Math.min(donor.slack, need);
      spans[donor.j] -= take;
      spans[i] += take;
      need -= take;
    }
  }
  return spans;
}

/** 画布里的一个块：高度给「无限大」，于是 cellContent 只按宽度排版、不裁字 */
function canvasPlan(id: PhotoBlockId, widthCm: number): ItemPlan {
  return {
    item: { id, col: 0, row: 0, colSpan: 1, rowSpan: 1 },
    widthCm,
    heightCm: NO_CLIP_CM,
    fontPt: 10.5,
    needCm: 0,
    fits: true,
    truncated: false,
    shrunk: false,
  };
}

/** 1pt 空段落：撑住空单元格 / 隔开两张相邻的表（Word 会把相连的两张表并成一张） */
function canvasSpacer(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
    children: [],
  });
}

/** 分页挂在段落上（坑 #26：单独一个分页段落落在页底会多出一张白纸） */
function canvasBreak(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
    children: [new PageBreak()],
  });
}

/** 行带之间的小间距：不只是隔开两张表，也让上下两段内容不贴在一起（约 6pt） */
function canvasGap(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 120, line: 20, lineRule: LineRuleType.EXACT },
    children: [],
  });
}

/**
 * 一页照片（画布流式）。document.ts 只在「用户在排版台改过位置」时走这里，
 * 默认预设仍然走 buildSingleFlowSection，保证默认流程零回归。
 */
export function buildCanvasFlowSection(params: CanvasFlowParams): (Paragraph | Table)[] {
  const { photo, index, image, settings, contentCm, heading, pageBreakBefore } = params;
  const layout = resolveLayout(settings);
  const analysis = photo.analysis;

  // 标题已经印在页头时，图注再印一遍同样的字就是重复（跟 buildSingleFlowSection 同一口径）
  const hasTitle =
    Boolean(analysis?.title?.trim()) && layout.items.some((item) => item.id === 'title');
  const items: LayoutItem[] = hasTitle
    ? layout.items.filter((item) => item.id !== 'caption')
    : layout.items;
  if (items.length === 0) return [];

  const gridParams: GridSectionParams = {
    photo,
    index,
    image,
    // 内容出不出现由画布决定：旧布尔开关一律放开，免得「拖上纸却被开关吞掉」
    settings: { ...settings, includeScoreDetail: true },
    contentCm,
    contentHeightCm: NO_CLIP_CM,
  };

  const out: (Paragraph | Table)[] = [];
  if (heading && heading.length > 0) out.push(...heading);
  if (pageBreakBefore && (!heading || heading.length === 0)) out.push(canvasBreak());

  const cols = Math.max(1, layout.cols);
  const totalTwips = Math.round(contentCm * 567);

  for (const band of canvasBands(items, layout.rows)) {
    const cells = canvasCells(band, cols);
    const spans = balanceSpans(cells, cols);

    // 宽度被匀成 0 的空白格直接不画（宽度总和仍是整 12 列）
    const planned = cells
      .map((cell, i) => ({ cell, span: spans[i] }))
      .filter((entry) => entry.span > 0);

    const rowCells = planned.map(({ cell, span }) => {
      // 图片独占一格：给它整列宽度、零边距，图不会顶出格子
      const imageOnly = cell.ids.length === 1 && cell.ids[0] === 'image';
      // 文字格留一点左右余白（约 1.9mm），免得正文紧贴图片/表格边线
      const gutterCm = imageOnly ? 0 : (CANVAS_GUTTER_TWIPS * 2) / 567;
      const widthCm = Math.max(1, (span / cols) * contentCm - gutterCm);
      const children: (Paragraph | Table)[] =
        cell.ids.length === 0
          ? [canvasSpacer()]
          : cell.ids.flatMap((id) => cellContent(canvasPlan(id, widthCm), gridParams));
      return new TableCell({
        width: { size: Math.round((span / cols) * totalTwips), type: WidthType.DXA },
        columnSpan: span > 1 ? span : undefined,
        // 单独一张图上下居中（像装裱）；图下面还叠着文字时按顶对齐
        verticalAlign: imageOnly ? VerticalAlign.CENTER : VerticalAlign.TOP,
        margins: imageOnly
          ? CELL_MARGINS
          : { top: 0, bottom: 0, left: CANVAS_GUTTER_TWIPS, right: CANVAS_GUTTER_TWIPS },
        children: children.length > 0 ? children : [canvasSpacer()],
      });
    });

    out.push(
      new Table({
        layout: TableLayoutType.FIXED,
        width: { size: totalTwips, type: WidthType.DXA },
        borders: NO_BORDERS,
        rows: [new TableRow({ children: rowCells })],
      }),
    );
    // 两张表之间必须夹一个段落，否则 Word 会当成一张表，列宽按最后一行算
    out.push(canvasGap());
  }

  return out;
}
