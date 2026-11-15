// src/lib/export/appendix.ts
// 0.5.5：书末「技术附录」。
// 参考真实摄影书：图注只写编号与标题，器材/曝光参数统一收到书末附录，
// 这样图版页干净、能放大图，需要查参数的人翻到最后一页就有全套。
'use client';

import { AlignmentType, BorderStyle, Paragraph, TabStopType, TextRun } from 'docx';

import { WORD_BODY, WORD_COLORS, WORD_FONTS, WORD_HEADER, toDocxColor } from '@/config/wordLayout';

import { buildAppendixRows } from './body';
import { buildRunStyle } from './fonts';
import type { Photo } from '@/types/domain';

export interface AppendixParams {
  photos: Photo[];
  contentWidthCm: number;
  /** 正文里已经用过「图 NN」编号，附录沿用同一套 */
  contentHeightCm?: number;
}

export function buildAppendix(params: AppendixParams): Paragraph[] {
  const { photos, contentWidthCm } = params;
  if (photos.length === 0) return [];

  const labelTabTwips = Math.round(2.3 * 567); // 编号占 2.3cm，后面的说明从同一竖线起
  const out: Paragraph[] = [];

  // 0.5.5：不要在附录前插「分页段落」。分页段落落在上一页最底部时，
  // Word / LibreOffice 会先吃掉它再空出一整页（实测印出过一张全白页）。
  // 改成把 pageBreakBefore 挂在小标段落自己身上 —— 只要求「从新页开始」，不会多出白页。
  out.push(
    new Paragraph({
      pageBreakBefore: true,
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 120, line: 240, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.sectionIndex, { color: toDocxColor(WORD_COLORS.lightGray) }),
          text: 'APPENDIX · 技术附录',
          characterSpacing: 60,
        }),
      ],
    }),
  );

  out.push(
    new Paragraph({
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 4,
          color: toDocxColor(WORD_HEADER.borderColor),
          space: 4,
        },
      },
      spacing: { before: 0, after: 200, line: 240, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.caption, { color: toDocxColor(WORD_COLORS.midGray) }),
          text: '按图版顺序列出每张照片的标题与拍摄参数，便于对照与复盘。',
        }),
      ],
    }),
  );

  photos.forEach((photo, i) => {
    const row = buildAppendixRows(photo, i + 1);
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        tabStops: [{ type: TabStopType.LEFT, position: labelTabTwips }],
        spacing: { before: 0, after: WORD_BODY.captionGapBeforePt * 20, line: 260, lineRule: 'auto' },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.caption, { color: toDocxColor(WORD_COLORS.midGray) }),
            text: row.label,
          }),
          new TextRun({
            ...buildRunStyle(WORD_FONTS.caption, { color: toDocxColor(WORD_COLORS.nearBlack) }),
            text: '\t' + (row.text || '—'),
          }),
        ],
      }),
    );
  });

  void contentWidthCm;
  return out;
}
