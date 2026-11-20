import { AlignmentType, Paragraph, TextRun } from 'docx';

import { WORD_COLORS, WORD_FONTS, toDocxColor } from '@/config/wordLayout';
import type { PhotoAnalysis } from '@/types/domain';

import { buildRunStyle } from './fonts';
import { paramLineInline } from './params';
import type { PhotoBlockId } from './blocks';

/**
 * 0.6.3：把「表格型」板块压成纯段落。
 *
 * 为什么需要：Word/LibreOffice 里 `<w:trHeight hRule="exact">` **不会裁掉超出内容**，
 * 单元格里再套一张小表（评分卡、三张建议卡、参数表）时，小表一高整行就长高，
 * 后面那几行的���被顶上来，渲染出来就是「字压在图片上」「参数表压在建议卡上」。
 *
 * 所以凡是要塞进格子的单元格，一律不再嵌表：评分/建议/参数都用段落表达，
 * 行高永远算得准，也不会互相压住。表格只在真正的网格骨架（外层那一张）里存在。
 */
export interface FlatBlockInput {
  id: PhotoBlockId;
  analysis: PhotoAnalysis | undefined;
  widthCm: number;
  index: number;
}

const DIM_ORDER: { key: keyof NonNullable<PhotoAnalysis['score']>['breakdown']; label: string }[] = [
  { key: 'composition', label: '构图' },
  { key: 'lighting', label: '光线' },
  { key: 'color', label: '调色' },
  { key: 'subject', label: '主体' },
  { key: 'timing', label: '时机' },
  { key: 'technique', label: '技术' },
];

const line = (): { before: number; after: number; line: number; lineRule: 'auto' } => ({
  before: 0,
  after: 40,
  line: 260,
  lineRule: 'auto',
});

function labelRun(text: string): TextRun {
  return new TextRun({
    ...buildRunStyle(WORD_FONTS.techniqueLabel, {
      sizeHalfPt: 15,
      color: toDocxColor(WORD_COLORS.midGray),
    }),
    text,
    characterSpacing: 40,
  });
}

function bodyRun(text: string): TextRun {
  return new TextRun({
    ...buildRunStyle(WORD_FONTS.storyBody, {
      sizeHalfPt: 17,
      color: toDocxColor(WORD_COLORS.nearBlack),
    }),
    text,
  });
}

/** 返回 null 表示「这个块不用压平」，调用方回落到正常渲染。 */
export function renderFlatBlock(input: FlatBlockInput): Paragraph[] | null {
  const { id, analysis } = input;
  if (!analysis) return null;
  const narrow = input.widthCm < 9;

  if (id === 'score') {
    const score = analysis.score;
    if (!score) return null;
    const out: Paragraph[] = [
      new Paragraph({
        spacing: line(),
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.storyBody, {
              sizeHalfPt: 16,
              color: toDocxColor(WORD_COLORS.midGray),
            }),
            text: '总分 ',
          }),
                    new TextRun({
            ...buildRunStyle(WORD_FONTS.storyBody, {
              sizeHalfPt: 30,
              bold: true,
              color: toDocxColor(WORD_COLORS.nearBlack),
            }),
            text: score.overall.toFixed(1),
          }),
          new TextRun({
            ...buildRunStyle(WORD_FONTS.storyBody, {
              sizeHalfPt: 15,
              color: toDocxColor(WORD_COLORS.midGray),
            }),
            text: ' /100',
          }),
        ],
      }),
    ];
    // 维度用「构图 82 · 光线 81」两列排，窄栏一列一行，避免数字被拆行
    const perLine = narrow ? 1 : 2;
    for (let i = 0; i < DIM_ORDER.length; i += perLine) {
      const group = DIM_ORDER.slice(i, i + perLine);
      out.push(
        new Paragraph({
          spacing: { ...line(), after: i + perLine >= DIM_ORDER.length ? 0 : 20 },
          children: group.flatMap((dim, gi) => {
            const value = score.breakdown?.[dim.key];
            if (typeof value !== 'number') return [];
            const runs: TextRun[] = [
              new TextRun({
                ...buildRunStyle(WORD_FONTS.storyBody, {
                  sizeHalfPt: 14,
                  color: toDocxColor(WORD_COLORS.midGray),
                }),
                text: (gi > 0 ? ' · ' : '') + `${dim.label} `,
              }),
              new TextRun({
                ...buildRunStyle(WORD_FONTS.storyBody, {
                  sizeHalfPt: 15,
                  color: toDocxColor(WORD_COLORS.nearBlack),
                }),
                text: String(Math.round(value)),
              }),
            ];
            return runs;
          }),
        }),
      );
    }
    return out;
  }

  if (id === 'advice') {
    const rows: { label: string; items: string[] | undefined }[] = [
      { label: '为什么好看', items: analysis.whyGood },
      { label: '可以更好', items: analysis.improve },
      { label: '下次这样拍', items: analysis.imitate },
    ];
    const usable = rows.filter((r) => (r.items ?? []).some((s) => s.trim()));
    if (usable.length === 0) return null;
    const out: Paragraph[] = [];
    usable.forEach((row, ri) => {
      out.push(
        new Paragraph({
          spacing: { before: ri === 0 ? 0 : 60, after: 20, line: 260, lineRule: 'auto' },
          children: [labelRun(row.label)],
        }),
      );
      (row.items ?? [])
        .filter((s) => s.trim())
        .slice(0, narrow ? 2 : 3)
        .forEach((s) => {
          out.push(
            new Paragraph({
              spacing: { before: 0, after: 20, line: 260, lineRule: 'auto' },
              indent: { left: 120 },
              alignment: AlignmentType.LEFT,
              children: [bodyRun(`· ${s.trim()}`)],
            }),
          );
        });
    });
    return out;
  }

  if (id === 'params') {
    const text = paramLineInline(analysis.params);
    if (!text) return null;
    return [
      new Paragraph({
        spacing: { before: 40, after: 0, line: 260, lineRule: 'auto' },
        children: [
          labelRun('参数'),
          bodyRun(`　${text}`),
        ],
      }),
    ];
  }

  return null;
}
