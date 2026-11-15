// src/lib/export/paragraphs.ts

import {
  AlignmentType,
  BorderStyle,
  LineRuleType,
  PageBreak,
  Paragraph,
  TextRun,
  convertMillimetersToTwip,
} from 'docx';

import { WORD_BODY, WORD_COLORS, type WordFontSpec } from '@/config/wordLayout';

import { buildRunStyle } from './fonts';

export const cmToTwips = (cm: number): number => convertMillimetersToTwip(cm * 10);

const hex = (color: string): string => color.replace('#', '').toUpperCase();

export function spacerParagraph(cm: number): Paragraph {
  return new Paragraph({
    spacing: {
      before: 0,
      after: 0,
      line: cmToTwips(cm),
      lineRule: LineRuleType.EXACT,
    },
    children: [new TextRun({ text: '', size: 2 })],
  });
}

export function dividerParagraph(
  widthCm: number,
  options: { color?: string; sizeEighths?: number; contentWidthCm?: number } = {},
): Paragraph {
  const content = options.contentWidthCm ?? 16.6;
  const inset = Math.max(0, (content - widthCm) / 2);

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: { left: cmToTwips(inset), right: cmToTwips(inset) },
    spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: options.sizeEighths ?? 6,
        color: hex(options.color ?? WORD_COLORS.lineBeige),
        space: 1,
      },
    },
    children: [new TextRun({ text: '', size: 2 })],
  });
}

export interface HeadingOptions {
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  lineTwips?: number;
  color?: string;
  keepNext?: boolean;
}

export function headingParagraph(
  text: string,
  spec: WordFontSpec,
  options: HeadingOptions = {},
): Paragraph {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.CENTER,
    keepNext: options.keepNext ?? true,
    spacing: {
      before: (options.spaceBeforePt ?? 0) * 20,
      after: (options.spaceAfterPt ?? 0) * 20,
      line: options.lineTwips ?? 288,
      lineRule: LineRuleType.AUTO,
    },
    children: [
      new TextRun({
        ...buildRunStyle(spec, { color: hex(options.color ?? WORD_COLORS.nearBlack) }),
        text,
      }),
    ],
  });
}

export interface BodyOptions {
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  firstLineTwips?: number;
  hangingTwips?: number;
  lineTwips?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  color?: string;
  keepNext?: boolean;
  /** 左右缩进（twips）：让正文块比图片窄一点，打印出来更像画册的「文字栏」 */
  insetTwips?: number;
}

export function bodyParagraph(
  text: string,
  spec: WordFontSpec,
  options: BodyOptions = {},
): Paragraph {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.JUSTIFIED,
    keepNext: options.keepNext,
    // 0.5.4：打印向 —— 禁止段落首尾出现孤行（一页只剩一行会被切到下一页）
    widowControl: true,
    indent: {
      firstLine: options.firstLineTwips,
      hanging: options.hangingTwips,
    },
    spacing: {
      before: (options.spaceBeforePt ?? 0) * 20,
      after: (options.spaceAfterPt ?? 0) * 20,
      line: options.lineTwips ?? WORD_BODY.storyLineTwips,
      lineRule: LineRuleType.AUTO,
    },
    children: [
      new TextRun({
        ...buildRunStyle(spec, { color: hex(options.color ?? WORD_COLORS.nearBlack) }),
        text,
      }),
    ],
  });
}

export interface MixedRun {
  text: string;
  spec: WordFontSpec;
  color?: string;
}

export function mixedBodyParagraph(runs: MixedRun[], options: BodyOptions = {}): Paragraph {
  return new Paragraph({
    alignment: options.alignment ?? AlignmentType.JUSTIFIED,
    keepNext: options.keepNext,
    widowControl: true,
    indent: {
      firstLine: options.firstLineTwips,
      hanging: options.hangingTwips,
      left: options.insetTwips,
      right: options.insetTwips,
    },
    spacing: {
      before: (options.spaceBeforePt ?? 0) * 20,
      after: (options.spaceAfterPt ?? 0) * 20,
      line: options.lineTwips ?? WORD_BODY.techniqueLineTwips,
      lineRule: LineRuleType.AUTO,
    },
    children: runs.map(
      (run) =>
        new TextRun({
          ...buildRunStyle(run.spec, { color: hex(run.color ?? WORD_COLORS.nearBlack) }),
          text: run.text,
        }),
    ),
  });
}

/** 记录哪些段落是分页段落，供 collapsePageBreaks 识别 */
const pageBreakTags = new WeakSet<Paragraph>();

export function pageBreakParagraph(): Paragraph {
  // 0.5.4：原来写的是 TextRun({ break: 1 })，docx 会输出 <w:br/>（换行），
  // 不是 <w:br w:type="page"/>（分页）——所以整本书其实从来没真正分过页。
  // 行高压到 1pt，避免新页顶端多出一条空白行。
  const paragraph = new Paragraph({
    children: [new PageBreak()],
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
  });
  pageBreakTags.add(paragraph);
  return paragraph;
}

export function isPageBreakParagraph(block: unknown): boolean {
  return typeof block === 'object' && block !== null && pageBreakTags.has(block as Paragraph);
}

/**
 * 去掉连续/开头的分页段落。
 * 章节扉页自带分页、首张照片又按 pageBreakPerPhoto 分一次，会在书里印出整张空白页。
 */
export function collapsePageBreaks<T>(blocks: T[]): T[] {
  const result: T[] = [];
  for (const block of blocks) {
    if (isPageBreakParagraph(block)) {
      const previous = result[result.length - 1];
      if (previous === undefined || isPageBreakParagraph(previous)) continue;
    }
    result.push(block);
  }
  // 结尾的分页符会多出一张空白纸（Word 里算进页数，打印就是白页），直接丢掉。
  while (result.length > 0 && isPageBreakParagraph(result[result.length - 1])) {
    result.pop();
  }
  return result;
}
