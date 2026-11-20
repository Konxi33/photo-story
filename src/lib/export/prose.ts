import { AlignmentType, LineRuleType, Paragraph, TextRun } from 'docx';

import { WORD_BODY, WORD_COLORS, WORD_FONTS, toDocxColor } from '@/config/wordLayout';
import { buildRunStyle } from './fonts';

/**
 * 0.6.3 新增：卷首语 / 后记这类「只有字的一页」。
 *
 * 画册里这两页很重要：翻开封面的第一段文字决定了读者愿不愿意继续看。
 * 所以做得很克制——一个小标签、一行标题、一段正文，其余全是留白。
 */
export interface ProseParams {
  /** 小标签，例如「写在前面」「后记」 */
  label: string;
  title: string;
  body: string;
  contentWidthCm: number;
  contentHeightCm: number;
  pageBreakBefore?: boolean;
}

/** 正文按空行切成段；段内换行也算分段（用户从别处粘过来的文本经常是硬换行） */
export function splitProse(body: string): string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 估算这段文字占多少行，供「能不能放进一页」的判断用 */
export function proseLinesCount(lines: string[], contentWidthCm: number): number {
  const perLine = Math.max(12, Math.floor(contentWidthCm / 0.42));
  return lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
}

export function buildProsePage(params: ProseParams): Paragraph[] {
  const { label, title, body, contentWidthCm, pageBreakBefore = true } = params;
  const blocks: Paragraph[] = [];

  blocks.push(
    new Paragraph({
      pageBreakBefore: pageBreakBefore || undefined,
      spacing: { before: 0, after: 0, line: 480, lineRule: LineRuleType.EXACT },
      children: [new TextRun({ text: label, ...buildRunStyle(WORD_FONTS.sectionIndex), color: toDocxColor(WORD_COLORS.midGray), characterSpacing: 120 })],
    }),
  );

  blocks.push(
    new Paragraph({
      spacing: { before: 480, after: 240, line: 620, lineRule: LineRuleType.EXACT },
      children: [new TextRun({ text: title, ...buildRunStyle(WORD_FONTS.sectionTitle), size: 40 })],
    }),
  );

  // 细线：和章节扉页同一条规矩，宽度跟着版心
  blocks.push(
    new Paragraph({
      spacing: { before: 0, after: 360 },
      border: { bottom: { style: 'single', size: 6, color: toDocxColor(WORD_HEADER_BORDER) } },
      children: [new TextRun({ text: '' })],
    }),
  );

  for (const line of splitProse(body)) {
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: { firstLine: Math.round(10.5 * 2 * 567 / 28.35) }, // 首行缩进两个字
        spacing: { before: 0, after: 180, line: WORD_BODY.storyLineTwips, lineRule: LineRuleType.EXACT },
        children: [new TextRun({ text: line, ...buildRunStyle(WORD_FONTS.storyBody), size: 21 })],
      }),
    );
  }

  // 版面检查留给调用方：这里只在末尾补一句「这页还可能有多长」的注释，不占版面
  void contentWidthCm;
  return blocks;
}

const WORD_HEADER_BORDER = '#d8d8de';
