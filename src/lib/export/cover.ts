// src/lib/export/cover.ts
'use client';

import { AlignmentType, ImageRun, Paragraph, TextRun, type Table } from 'docx';

import { WORD_BODY, WORD_COLORS, WORD_COVER, WORD_FONTS, PT_TO_HALF_POINT, toDocxColor } from '@/config/wordLayout';
import { formatDate } from '@/lib/utils';

import { buildRunStyle } from './fonts';
import { fitIntoFrame, type EncodedImage } from './image-encode';
import { dividerParagraph, pageBreakParagraph, spacerParagraph } from './paragraphs';

export interface CoverParams {
  projectName: string;
  coverImage?: EncodedImage;
  photoCount: number;
  exportDate: Date;
  /** 正文可用宽度（cm），封面跟着纸张走 */
  contentWidthCm?: number;
  /** 0.5.4：封面已单独成节时传 false —— 节分隔本身就会另起一页 */
  endWithBreak?: boolean;
  /** 0.8.3：封面上要不要印日期（送人的册子常常不要） */
  showDate?: boolean;
}

export function buildCoverSection(params: CoverParams): (Paragraph | Table)[] {
  const { projectName, coverImage, photoCount, exportDate } = params;

  const name = projectName.trim() || '照片故事';
  // 0.5.4：短标题给更大的字号 —— 封面印出来时，两三个字的标题用 26pt 显得怯
  const titleHalfPt =
    name.length <= 6
      ? PT_TO_HALF_POINT(40)
      : name.length <= 12
        ? WORD_COVER.titleSizeHalfPt
        : WORD_COVER.titleCompactSizeHalfPt;

  const blocks: (Paragraph | Table)[] = [];

  blocks.push(spacerParagraph(WORD_COVER.topSpacerCm));

  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0, line: WORD_COVER.titleLineTwips, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.coverTitle, {
            sizeHalfPt: titleHalfPt,
            color: toDocxColor(WORD_COLORS.nearBlack),
          }),
          text: name,
        }),
      ],
    }),
  );

  blocks.push(spacerParagraph(0.3));
  blocks.push(
    dividerParagraph(WORD_COVER.dividerWidthCm, {
      color: WORD_COLORS.lineBeige,
      sizeEighths: WORD_COVER.dividerSizeEighths,
      contentWidthCm: params.contentWidthCm ?? WORD_BODY.frameCompact.widthCm,
    }),
  );
  blocks.push(spacerParagraph(0.3));

  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0, line: WORD_COVER.subtitleLineTwips, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.coverSubtitle, {
            color: toDocxColor(WORD_COLORS.midGray),
          }),
          text: '照片故事',
        }),
      ],
    }),
  );

  if (coverImage) {
    blocks.push(spacerParagraph(WORD_COVER.gapBeforeImageCm));

    const size = fitIntoFrame(coverImage, {
      widthCm: Math.min(WORD_COVER.imageMaxWidthCm, params.contentWidthCm ?? WORD_COVER.imageMaxWidthCm),
      heightCm: WORD_COVER.imageMaxHeightCm,
    });

    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
        children: [
          new ImageRun({
            type: 'jpg',
            data: coverImage.data,
            transformation: { width: size.widthPx, height: size.heightPx },
          }),
        ],
      }),
    );

    blocks.push(spacerParagraph(WORD_COVER.gapAfterImageCm));
  } else {
    blocks.push(spacerParagraph(WORD_COVER.gapBeforeImageCm));
  }

  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.coverFooter, {
            color: toDocxColor(WORD_COLORS.lightGray),
          }),
          text:
            (params.showDate === false ? '' : formatDate(exportDate) + ' · ') + '共 ' + photoCount + ' 张',
        }),
      ],
    }),
  );

  if (params.endWithBreak !== false) blocks.push(pageBreakParagraph());
  return blocks;
}
