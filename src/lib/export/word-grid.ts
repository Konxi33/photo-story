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

// 说明：网格页不需要显式分页（见 buildGridPhotoSection 里的注释），
// 所以这里不引 pageBreakParagraph。
import { type EncodedImage } from './image-encode';
import {
  measureTextCm,
  planLayoutPage,
  resolveLayout,
  type ItemPlan,
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

  if (params.heading && params.heading.length > 0) out.push(...params.heading);

  const headingCm = params.heading && params.heading.length > 0 ? 5.0 : 0;
  const widthCm = Math.min(contentCm, 14.6);

  // 图能占多高，得先算清文字要占多少 —— 否则一张照片连同文字会溢到第二页，
  // 正是用户说的「图和字分到两页」。这里按字数估行数（中文 1em、西文 0.55em）。
  const innerCm = contentCm - 0.5;
  const need = (text: string | undefined, pt: number, ratio = 1.95): number => {
    if (!text || !text.trim()) return 0;
    // 1.12 是实测校准系数：估出来的高度总比 LibreOffice 实际排出来的矮一点
    return measureTextCm(text, innerCm, pt, ratio).needCm * 1.12;
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
  for (const drop of DROP_ORDER) {
    if (total + MIN_IMAGE + headingCm + 2.2 <= contentHeightCm) break;
    if (!ids.includes(drop)) continue;
    ids = ids.filter((id) => id !== drop);
    total -= costOf(drop);
  }
  const avail = contentHeightCm - total - headingCm - 2.2;
  const imageFrame = {
    widthCm,
    heightCm: Math.max(MIN_IMAGE, Math.min(15, avail)),
  };

  const render = (id: PhotoBlockId) => {
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

  for (const id of ids) {
    if (id === 'index' || id === 'title') continue;
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
