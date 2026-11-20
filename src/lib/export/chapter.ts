// src/lib/export/chapter.ts
// 0.5.2：把「编排」里的章节结构画进 Word。
// 每章一页章节页：章号 → 细分隔线 → 章节标题 → 题记，然后才进照片。
// 没有章节数据时走原来的平铺逻辑，导出的样子不变。

'use client';

import { AlignmentType, BorderStyle, Paragraph, TextRun, type Table } from 'docx';

import { PT_TO_HALF_POINT, WORD_BODY, WORD_COLORS, WORD_FONTS, toDocxColor } from '@/config/wordLayout';

import { buildRunStyle } from './fonts';
import { dividerParagraph, pageBreakParagraph, spacerParagraph } from './paragraphs';

export interface ChapterOpenerParams {
  /** 章节序号，从 1 开始 */
  index: number;
  title: string;
  note: string;
  /** 前面还有没有内容：没有就不必先分页 */
  hasPreviousContent: boolean;
  /** 章节页后面是否分页；空章后面直接接下一章时要关掉，免得留一页白纸 */
  endWithBreak?: boolean;
  /** 正文可用宽度（cm），随纸张与装订线变化，默认 A4 标准边距 */
  contentWidthCm?: number;
  /** 正文可用高度（cm），用来把扉页内容垂直居中，默认 A4 标准边距 */
  contentHeightCm?: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * 0.5.6：呼吸页——章与章之间的一页留白，只放一行引文。
 * 编排里把章节标题清空、只留题记，就会导出成这种页面（真实摄影书里常见）。
 */
function buildQuietPage(
  noteText: string,
  options: { pageBreakBefore: boolean; contentHeightCm: number },
): (Paragraph | Table)[] {
  const lineCount = Math.max(1, Math.ceil(noteText.length / 18));
  const blockCm = lineCount * 0.95;
  const topCm = Math.max(5, Math.min(12, (options.contentHeightCm - blockCm) / 2));

  const blocks: (Paragraph | Table)[] = [];
  blocks.push(spacerParagraph(topCm));
  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      pageBreakBefore: options.pageBreakBefore,
      spacing: { before: 0, after: 0, line: 400, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.coverSubtitle),
          size: PT_TO_HALF_POINT(13),
          color: toDocxColor(WORD_COLORS.midGray),
          text: noteText,
        }),
      ],
    }),
  );
  blocks.push(spacerParagraph(0.6));
  blocks.push(dividerParagraph(3.2));
  return blocks;
}

export function buildChapterOpener(params: ChapterOpenerParams): (Paragraph | Table)[] {
  const {
    index,
    title,
    note,
    hasPreviousContent,
    endWithBreak = true,
    contentWidthCm,
    contentHeightCm = 25.3,
  } = params;

  // 0.5.6：空标题 + 有题记 = 呼吸页（只放引文，不写章号）
  if (!title.trim() && note.trim()) {
    const quiet = buildQuietPage(note.trim(), {
      pageBreakBefore: hasPreviousContent,
      contentHeightCm,
    });
    if (endWithBreak) quiet.push(pageBreakParagraph());
    return quiet;
  }

  const name = title.trim() || '第 ' + index + ' 章';
  const blocks: (Paragraph | Table)[] = [];
  const noteText = note.trim();

  // 扉页上的内容块大概多高（cm）：章号 + 空档 + 细线 + 空档 + 章名 + 题记
  const titleCm = name.length <= 8 ? 1.9 : name.length <= 14 ? 1.6 : 1.3;
  const blockCm = 0.95 + 0.5 + 0.3 + 0.55 + titleCm + (noteText.length > 0 ? 1.5 : 0);
  // 上下留白相等，扉页内容落在纸面中线附近；太靠上会显得像排版没做完
  const topCm = Math.max(4.5, Math.min(11.5, (contentHeightCm - blockCm) / 2));

  if (hasPreviousContent) blocks.push(pageBreakParagraph());

  blocks.push(spacerParagraph(topCm));

  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0, line: 260, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.sectionIndex, {
            color: toDocxColor(WORD_COLORS.lightGray),
          }),
          text: '第 ' + pad2(index) + ' 章',
          characterSpacing: 60,
        }),
      ],
    }),
  );

  blocks.push(spacerParagraph(0.5));
  blocks.push(
    dividerParagraph(3.6, {
      color: WORD_COLORS.lineBeige,
      sizeEighths: 6,
      contentWidthCm: contentWidthCm ?? WORD_BODY.frameCompact.widthCm,
    }),
  );
  blocks.push(spacerParagraph(0.55));

  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0, line: 460, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.sectionTitle, {
            color: toDocxColor(WORD_COLORS.nearBlack),
          }),
          // 扉页上只有一句话，字要够大才撑得住一整页白纸
          size: PT_TO_HALF_POINT(name.length <= 8 ? 30 : name.length <= 14 ? 24 : 20),
          text: name,
        }),
      ],
    }),
  );

  if (noteText.length > 0) {
    blocks.push(spacerParagraph(0.7));
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: 360, lineRule: 'auto' },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.coverSubtitle, {
              color: toDocxColor(WORD_COLORS.midGray),
            }),
            text: noteText,
          }),
        ],
      }),
    );
  }

  if (endWithBreak) blocks.push(pageBreakParagraph());
  return blocks;
}

/**
 * 单张照片的章节用「紧凑章头」：不再单独占一整页扉页，
 * 章号、章名、分隔线直接压在这张照片页的顶端 —— 打印出来不浪费纸，也不会看着空。
 */
export function buildChapterHeading(params: {
  index: number;
  title: string;
  note: string;
  contentWidthCm?: number;
  /** 0.6.4：紧凑章头（小章节和照片挤在同一页顶上）—— 单行左对齐，不再居中三行 */
  compact?: boolean;
}): (Paragraph | Table)[] {
  // 0.5.6：空标题 + 有题记 = 呼吸页
  if (!params.title.trim() && params.note.trim()) {
    return buildQuietPage(params.note.trim(), {
      pageBreakBefore: true,
      contentHeightCm: 25.3,
    });
  }

  const name = params.title.trim() || '第 ' + params.index + ' 章';
  const contentCm = params.contentWidthCm ?? WORD_BODY.frameCompact.widthCm;
  const blocks: (Paragraph | Table)[] = [];

  // 0.6.4：紧凑章头改成画册口径的一行 —— 章号小字 + 章名大字，左对齐，下面一条细线。
  // 原来居中三行加满宽分隔线，一页顶上要吃掉 30mm，照片被挤得很小。
  if (params.compact) {
    const noteText = params.note.trim();
    blocks.push(
      new Paragraph({
        pageBreakBefore: true,
        alignment: AlignmentType.LEFT,
        keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D8D8D8', space: 6 } },
        spacing: { before: 0, after: 160, line: 380, lineRule: 'auto' },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.sectionIndex, { color: toDocxColor(WORD_COLORS.lightGray) }),
            text: '第 ' + pad2(params.index) + ' 章',
            characterSpacing: 40,
          }),
          new TextRun({ text: '　' }),
          new TextRun({
            ...buildRunStyle(WORD_FONTS.sectionTitle, { color: toDocxColor(WORD_COLORS.nearBlack) }),
            text: name,
          }),
          ...(noteText
            ? [
                new TextRun({ text: '　' }),
                new TextRun({
                  ...buildRunStyle(WORD_FONTS.coverSubtitle, { color: toDocxColor(WORD_COLORS.midGray) }),
                  text: noteText,
                }),
              ]
            : []),
        ],
      }),
    );
    return blocks;
  }

  blocks.push(
    new Paragraph({
      // 章节之间仍然必须从新页开始，用段落属性而不是分页段落，
      // 这样后面的照片不会再多分一次页（多一页空白）。
      pageBreakBefore: true,
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 0, after: 0, line: 280, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.sectionIndex, {
            color: toDocxColor(WORD_COLORS.lightGray),
          }),
          text: '第 ' + pad2(params.index) + ' 章',
          characterSpacing: 60,
        }),
      ],
    }),
  );

  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 40, after: 80, line: 420, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.sectionTitle, {
            color: toDocxColor(WORD_COLORS.nearBlack),
          }),
          text: name,
        }),
      ],
    }),
  );

  const noteText = params.note.trim();
  if (noteText.length > 0) {
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        spacing: { before: 0, after: 100, line: 300, lineRule: 'auto' },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.coverSubtitle, {
              color: toDocxColor(WORD_COLORS.midGray),
            }),
            text: noteText,
          }),
        ],
      }),
    );
  }

  blocks.push(
    dividerParagraph(3.6, {
      color: WORD_COLORS.lineBeige,
      sizeEighths: 6,
      contentWidthCm: contentCm,
    }),
  );

  return blocks;
}

/**
 * 按章节把照片列表重排成「章 → 该章照片 → 未编排照片」。
 * 返回结构里每段要么是章节头，要么是一批照片，调用方顺序拼接即可。
 */
export interface ChapterPlan {
  chapter: { id: string; title: string; note: string };
  photos: import('@/types/domain').Photo[];
}

export function planChapters(
  photos: import('@/types/domain').Photo[],
  chapters: { id: string; title: string; note: string; photoIds: string[] }[],
): { plan: ChapterPlan[]; rest: import('@/types/domain').Photo[] } {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const used = new Set<string>();
  const plan: ChapterPlan[] = [];

  for (const chapter of chapters) {
    const items: import('@/types/domain').Photo[] = [];
    for (const id of chapter.photoIds) {
      const photo = byId.get(id);
      if (!photo) continue; // 章节里残留了已删除的照片
      if (used.has(id)) continue; // 同一张不要在两章出现两次
      used.add(id);
      items.push(photo);
    }
    // 空章也保留标题页：用户可能就是想留一页扉页
    plan.push({ chapter, photos: items });
  }

  const rest = photos.filter((photo) => !used.has(photo.id));
  return { plan, rest };
}