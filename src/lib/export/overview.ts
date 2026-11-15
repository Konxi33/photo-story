// src/lib/export/overview.ts
'use client';

import {
  AlignmentType,
  BorderStyle,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ITableBordersOptions,
} from 'docx';

import {
  CM_TO_TWIPS,
  WORD_COLORS,
  WORD_FONTS,
  WORD_OVERVIEW,
  WORD_PAGE,
  toDocxColor,
} from '@/config/wordLayout';
import type { Photo } from '@/types/domain';

import { buildRunStyle } from './fonts';
import { fitIntoFrame, type EncodedImage } from './image-encode';
import { pageBreakParagraph } from './paragraphs';

export interface OverviewParams {
  photos: Photo[];
  images: Map<string, EncodedImage>;
  columns: number;
  exportDate: Date;
  /** 正文可用宽度（cm），随纸张与装订线变化 */
  contentWidthCm?: number;
  /** 总览页后面是否分页（后面紧跟章节扉页时不需要） */
  endWithBreak?: boolean;
  /** 每页排几行缩略图 */
  rowsPerPage?: number;
  /** 行间距（pt） */
  rowGapPt?: number;
}

/**
 * 算一个「尽量把所有照片排进一页」的网格。
 * 0.5.4：原来固定 3 列 × 5 行，20 张会溢出到第二页、第二页还只剩 2/3 空白，浪费纸。
 * 0.5.5：不再把剩余空间平摊成超大的行间距 —— 那样 Word / LibreOffice 会把整页撑开，
 * 本来一页能放下的照片被拆成两页，结果比原来更难看。
 */
export function planOverviewGrid(params: {
  count: number;
  contentWidthCm: number;
  contentHeightCm: number;
  minColumns?: number;
  maxColumns?: number;
}): { columns: number; rowsPerPage: number; rowGapPt: number } {
  const count = Math.max(1, params.count);
  const minColumns = params.minColumns ?? 3;
  const maxColumns = params.maxColumns ?? 6;
  // 顶部标题 + 上下间距约占 1.6cm
  const usableHeight = Math.max(6, params.contentHeightCm - 1.6);
  const rowGapPt = WORD_OVERVIEW.rowGapBeforePt;
  const gapCm = (rowGapPt / 28.35) * 0.75;
  // 单元格上下边距 + 图注一行
  const rowChrome = 0.9;

  for (let columns = minColumns; columns <= maxColumns; columns += 1) {
    const cellWidth = params.contentWidthCm / columns;
    const thumbWidth = Math.min(WORD_OVERVIEW.thumbWidthCm, Math.max(2, cellWidth - 0.3));
    const thumbHeight = thumbWidth / WORD_OVERVIEW.thumbAspect;
    const rowHeight = thumbHeight + rowChrome + gapCm;
    const rowsNeeded = Math.ceil(count / columns);
    if (rowsNeeded * rowHeight <= usableHeight) {
      return { columns, rowsPerPage: rowsNeeded, rowGapPt };
    }
  }

  const columns = maxColumns;
  const cellWidth = params.contentWidthCm / columns;
  const thumbWidth = Math.min(WORD_OVERVIEW.thumbWidthCm, Math.max(2, cellWidth - 0.3));
  const rowHeight = thumbWidth / WORD_OVERVIEW.thumbAspect + rowChrome + gapCm;
  return {
    columns,
    rowsPerPage: Math.max(2, Math.floor(usableHeight / rowHeight)),
    rowGapPt,
  };
}

const ellipsis = (text: string, max: number): string =>
  text.length > max ? text.slice(0, max) + '…' : text;

const pad2 = (n: number): string => String(n).padStart(2, '0');

const noBorders: ITableBordersOptions = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

/**
 * 总览图版（缩略图方阵）。
 *
 * 历史（重要，别再踩回去）：
 *  · 0.5.4 早期用「Table + 精确行高」→ LibreOffice / WPS 直接把整张表丢掉，总览页只剩标题；
 *  · 改成「每行一个段落 + 制表位 + 内联图片」→ Word 能对，但 LibreOffice 里同一段落内的
 *    多张内联图不会推进行高，四列图会上下互相压住（实测 20 张糊成一片）。
 *  · 0.5.5 定稿：无边框表格 + 固定列宽 + **不设行高**（含精确行高才会被丢），
 *    每格一张图 + 一行图注。Word / LibreOffice / WPS 三边都稳定。
 */
export function buildOverviewSection(params: OverviewParams): (Paragraph | Table)[] {
  const { photos, images, columns, exportDate } = params;
  const contentCm = params.contentWidthCm ?? WORD_PAGE.contentWidthCm;
  const blocks: (Paragraph | Table)[] = [];

  const dateText =
    exportDate.getFullYear() + '-' + pad2(exportDate.getMonth() + 1) + '-' + pad2(exportDate.getDate());

  blocks.push(
    new Paragraph({
      spacing: { before: 0, after: 160, line: 288, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.overviewTitle, { color: toDocxColor(WORD_COLORS.nearBlack) }),
          text: '总览　',
        }),
        new TextRun({
          ...buildRunStyle(WORD_FONTS.overviewMeta, { color: toDocxColor(WORD_COLORS.lightGray) }),
          text: '共 ' + photos.length + ' 张 · 生成于 ' + dateText,
        }),
      ],
    }),
  );

  const rowsPerPage = params.rowsPerPage ?? WORD_OVERVIEW.rowsPerPage;
  const perPage = columns * rowsPerPage;
  const cellTwips = Math.floor(CM_TO_TWIPS(contentCm) / columns);
  const cellWidthCm = contentCm / columns;
  const thumbWidthCm = Math.min(WORD_OVERVIEW.thumbWidthCm, Math.max(2, cellWidthCm - 0.3));

  for (let start = 0; start < photos.length; start += perPage) {
    if (start > 0) blocks.push(pageBreakParagraph());

    const chunk = photos.slice(start, start + perPage);
    const rows: TableRow[] = [];

    for (let r = 0; r * columns < chunk.length; r += 1) {
      const cells: TableCell[] = [];

      for (let c = 0; c < columns; c += 1) {
        const photo = chunk[r * columns + c];
        const children: Paragraph[] = [];

        if (photo) {
          const image = images.get(photo.id);
          if (image) {
            const size = fitIntoFrame(image, {
              widthCm: thumbWidthCm,
              heightCm: WORD_OVERVIEW.thumbHeightCm,
            });
            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 40, line: 240, lineRule: 'auto' },
                children: [
                  new ImageRun({
                    type: 'jpg',
                    data: image.data,
                    transformation: { width: size.widthPx, height: size.heightPx },
                  }),
                ],
              }),
            );
          }

          const indexInAll = start + r * columns + c + 1;
          const title = photo.analysis?.title ?? photo.fileName;
          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: ((params.rowGapPt ?? WORD_OVERVIEW.rowGapBeforePt) * 20) / 2, line: 240, lineRule: 'auto' },
              children: [
                new TextRun({
                  ...buildRunStyle(WORD_FONTS.caption, { color: toDocxColor(WORD_COLORS.midGray) }),
                  text: pad2(indexInAll) + ' · ' + ellipsis(title, WORD_OVERVIEW.captionMaxChars),
                }),
              ],
            }),
          );
        }

        if (children.length === 0) {
          children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
        }

        cells.push(
          new TableCell({
            width: { size: cellTwips, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 60, bottom: 60, left: 40, right: 40 },
            children,
          }),
        );
      }

      rows.push(new TableRow({ cantSplit: true, children: cells }));
    }

    blocks.push(
      new Table({
        layout: TableLayoutType.FIXED,
        width: { size: cellTwips * columns, type: WidthType.DXA },
        borders: noBorders,
        rows,
      }),
    );
  }

  if (params.endWithBreak !== false) blocks.push(pageBreakParagraph());
  return blocks;
}
