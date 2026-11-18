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
} from 'docx';

import { WORD_COLORS, WORD_FONTS, toDocxColor } from '@/config/wordLayout';
import type { ExportSettings, Photo, PhotoAnalysis, Technique } from '@/types/domain';

import { type BlockContext, buildPhotoSection, renderBlock } from './body';
import { buildRunStyle } from './fonts';
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
  const heightCm = contentHeightCm;

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
