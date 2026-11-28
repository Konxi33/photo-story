// src/lib/export/body.ts
'use client';

import {
  AlignmentType,
  BorderStyle,
  ImageRun,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ITableBordersOptions,
} from 'docx';

import { WORD_BODY, WORD_COLORS, WORD_FONTS, toDocxColor } from '@/config/wordLayout';
import { formatCamera, formatExifLine } from '@/lib/image/exif';
import type { ExportSettings, Photo, PhotoAnalysis, Technique } from '@/types/domain';

import { type PhotoBlockId, planPhotoPage } from './blocks';
import { buildRunStyle } from './fonts';
import { fitIntoFrame, type EncodedImage } from './image-encode';
import { exportContentCm, exportContentHeightCm, exportFrameCm } from './metrics';
import {
  bodyParagraph,
  dividerParagraph,
  mixedBodyParagraph,
  pageBreakParagraph,
} from './paragraphs';
import { tidyParam } from './params';

export interface PhotoSectionParams {
  photo: Photo;
  index: number;
  image: EncodedImage | null;
  settings: ExportSettings;
  isFirst: boolean;
  /** 0.5.4：这一页顶端还压着章头（单张章节的内联章号/章名），要给它让出高度 */
  hasChapterHeading?: boolean;
}

const TECHNIQUE_LABELS: Record<keyof Technique, string> = {
  composition: '构图',
  lighting: '光线',
  color: '色彩',
  lens: '镜头',
  post: '后期',
};

const TECHNIQUE_ORDER: (keyof Technique)[] = [
  'composition',
  'lighting',
  'color',
  'lens',
  'post',
];

/** 0.5.7：规格化逻辑搬到 `params.ts`，让 canvas 相框（frame.ts）也能复用。 */
export { tidyParam } from './params';

/**
 * 图注。0.8.4：去掉「图 01 · 」编号前缀 —— 用户明确说照片旁那个小数字不需要。
 * 现在的口径是「标题（或参数）单独一行，行首一道破折线」，和 PDF 竖排版完全一致：
 * 标题已经印在照片上方时不重复（由调用方决定是否省略图注块）。
 */
function buildImageCaption(photo: Photo, index: number, style: 'title' | 'param' | 'both'): string {
  void index;
  const title = (photo.status === 'success' ? photo.analysis?.title : '')?.trim() || '';
  const paramText = buildParamLine(photo);

  if (style === 'param') return paramText;
  if (style === 'both') return [title, paramText].filter(Boolean).join(' · ');
  return title || paramText;
}

/** 一行器材与曝光参数（EXIF 优先，没有就用模型读出来的 params） */
function buildParamLine(photo: Photo): string {
  const exifLine = formatExifLine(photo.exif).trim();
  if (exifLine) return exifLine;

  if (photo.status === 'success' && photo.analysis?.params) {
    const p = photo.analysis.params;
    return [
      tidyParam(p.focalLength, 'focal'),
      tidyParam(p.aperture, 'aperture'),
      tidyParam(p.shutter, 'shutter'),
      tidyParam(p.iso, 'iso'),
      tidyParam(p.colorGrade, 'color'),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return '';
}

/** 书末技术附录用：每张照片的编号、标题与参数（图注不印参数时补在这里） */
export function buildAppendixRows(photo: Photo, index: number): { label: string; text: string } {
  const title = (photo.status === 'success' ? photo.analysis?.title : '')?.trim() || '';
  const param = buildParamLine(photo);
  return {
    label: '图 ' + String(index).padStart(2, '0'),
    text: [title, param].filter(Boolean).join('　'),
  };
}

/* ------------------------------ 板块渲染 ------------------------------ */

export interface BlockContext {
  photo: Photo;
  index: number;
  image: EncodedImage | null;
  settings: ExportSettings;
  analysis?: PhotoAnalysis;
  contentCm: number;
  /** 图片可用高度（由 planPhotoPage 算好，cm） */
  imageRoomCm: number;
  imageFrame: { widthCm: number; heightCm: number } | null;
  /**
   * 这一页的「粘合」标记：0.5.7 起所有板块都设 keepNext，让 Word 把整页当成
   * 一个不可分割的整体；最后由 buildPhotoSection 收尾的那个空段落结束链条。
   */
  sticky: boolean;
}

/** 段落通用外壳：居中/左对齐 + 粘合 + 可选「另起一页」 */
function blockParagraph(options: {
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  ctx: BlockContext;
  spacing: { before?: number; after?: number; line?: number; lineRule?: 'auto' | 'exact' };
  indent?: { left?: number; right?: number };
  children: TextRun[];
  lead?: LeadFlags;
  /** 这一块里是不是最后一个段落；不是的话保持粘合 */
  tailOfPage?: boolean;
}): Paragraph {
  const { ctx } = options;
  return new Paragraph({
    alignment: options.alignment,
    indent: options.indent,
    keepNext: ctx.sticky && !options.tailOfPage,
    spacing: options.spacing,
    children: options.children,
    pageBreakBefore: options.lead?.pageBreakBefore || undefined,
  });
}

interface LeadFlags {
  /** 这张照片的页要不要从新的一页开始（pageBreakPerPhoto） */
  pageBreakBefore?: boolean;
}

/** 读一页里最后一个板块，用来收尾（不粘合下一段） */
function lastBlockId(blocks: PhotoBlockId[]): PhotoBlockId | undefined {
  return blocks[blocks.length - 1];
}

/**
 * 一页照片。0.5.7 起顺序完全由用户决定（`settings.blocks`），这里只负责：
 *   1. 按 planPhotoPage 的预算决定图片多大、哪些板块装不下要被省略；
 *   2. 整页所有段落 keepNext 串成一条链，**保证图片和它的文字不会被分到两页**。
 */
export function buildPhotoSection(params: PhotoSectionParams): (Paragraph | Table)[] {
  const { photo, index, image, settings, isFirst } = params;
  const analysis = photo.status === 'success' ? photo.analysis : undefined;

  const contentCm = exportContentCm(settings);
  const contentHeightCm = exportContentHeightCm(settings);
  const fit = planPhotoPage({
    photo,
    settings,
    contentCm,
    contentHeightCm,
    hasChapterHeading: params.hasChapterHeading,
  });

  // 装不下时 planPhotoPage 会把低优先级板块标进 dropped，这里就不画它们了
  const ids = fit.blocks.filter((id) => !fit.dropped.includes(id));

  const frame = image ? resolveImageFrame(image, settings, fit.imageRoomCm) : null;

  const ctx: BlockContext = {
    photo,
    index,
    image,
    settings,
    analysis,
    contentCm,
    imageRoomCm: fit.imageRoomCm,
    imageFrame: frame,
    sticky: true,
  };

  const out: (Paragraph | Table)[] = [];

  // 分页放在这一页第一个段落上（pageBreakBefore），而不是单独塞一个分页段落：
  // 单独的分页段落 + 「整页粘合」会在装不下时多印一张空白页。
  const needsBreak = !isFirst && settings.pageBreakPerPhoto;
  const first = ids[0];
  const firstIsTable = first === 'params' || first === 'score' || first === 'advice';
  if (needsBreak && firstIsTable) out.push(pageBreakParagraph());
  const lead: LeadFlags = { pageBreakBefore: needsBreak && !firstIsTable };

  const tail = lastBlockId(ids);

  for (const id of ids) {
    const isTail = id === tail;
    out.push(...renderBlock(id, ctx, lead, isTail));
    // 分页只给第一个板块
    lead.pageBreakBefore = false;
  }

  if (!analysis && ids.length === 0) {
    // 分析失败的照片：至少留一句提示，别印出空白页
    out.push(
      blockParagraph({
        ctx,
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: WORD_BODY.storyLineTwips },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.storyBody, { color: toDocxColor(WORD_COLORS.lightGray) }),
            text: '（待补充）',
          }),
        ],
        lead,
      }),
    );
  }

  // 粘合链条的收尾：极小的空段落，keepNext 为 false，让上面整页不被拆开
  out.push(
    new Paragraph({
      spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' },
      children: [new TextRun({ text: '', size: 2 })],
    }),
  );

  return out;
}

/** 图片尺寸：竖图给更高的框，但都不超过这一页能给的 imageRoomCm */
function resolveImageFrame(
  image: EncodedImage,
  settings: ExportSettings,
  imageRoomCm: number,
): { widthCm: number; heightCm: number } {
  const base = exportFrameCm(settings);
  const isPortrait = image.height > image.width;
  const pageHeight = exportContentHeightCm(settings);

  if (isPortrait) {
    const heightCm = Math.min(
      Math.max(imageRoomCm, 6.6),
      base.heightCm + 3.2,
      pageHeight * 0.58,
    );
    return { widthCm: base.widthCm, heightCm };
  }

  const heightCm = Math.max(6.6, Math.min(base.heightCm, imageRoomCm));
  return { widthCm: base.widthCm, heightCm };
}

/** 按板块逐个渲染（每个函数只负责自己那几段） */
export function renderBlock(
  id: PhotoBlockId,
  ctx: BlockContext,
  lead: LeadFlags,
  isTail: boolean,
): (Paragraph | Table)[] {
  const analysis = ctx.analysis;
  const settings = ctx.settings;

  switch (id) {
    case 'index':
      // 0.8.4：照片左上角那个「01 / 02」小数字，用户明确说不需要。
      // 排版台上如果还摆着「序号」积木，导出时一律当空块处理（不占位、不留白）。
      return [];

    case 'title': {
      return [
        blockParagraph({
          ctx,
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: WORD_BODY.gapAfterTitlePt * 20, line: 288 },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.sectionTitle, { color: toDocxColor(WORD_COLORS.nearBlack) }),
              text: analysis?.title || ctx.photo.fileName,
            }),
          ],
          lead,
        }),
        // 标题下面那条细线（0.5.6 及以前是独立步骤，现在跟着标题走）
        dividerParagraph(Math.min(WORD_BODY.dividerWidthCm, ctx.contentCm), {
          color: WORD_COLORS.lineBeige,
          sizeEighths: WORD_BODY.dividerSizeEighths,
          contentWidthCm: ctx.contentCm,
          keepNext: ctx.sticky && !isTail,
        }),
      ];
    }

    case 'image': {
      if (!ctx.image || !ctx.imageFrame) return [];
      const size = fitIntoFrame(ctx.image, ctx.imageFrame);
      return [
        new Paragraph({
          // 0.6.4：照片左对齐，跟章头、标题、正文共用同一条左边线（画册惯例）
          alignment: AlignmentType.LEFT,
          keepNext: ctx.sticky && !isTail,
          pageBreakBefore: lead.pageBreakBefore || undefined,
          spacing: { before: WORD_BODY.gapAfterImagePt * 20, after: 0, line: 240 },
          children: [
            new ImageRun({
              type: 'jpg',
              data: ctx.image.data,
              transformation: { width: size.widthPx, height: size.heightPx },
            }),
          ],
        }),
      ];
    }

    case 'caption': {
      if (!ctx.image || settings.captionUnderImage === false) return [];
      const caption = buildImageCaption(ctx.photo, ctx.index, settings.captionStyle ?? 'title');
      if (!caption) return [];
      const size = fitIntoFrame(ctx.image, ctx.imageFrame ?? { widthCm: ctx.contentCm, heightCm: 8 });
      const imageWidthCm = (size.widthPx / 96) * 2.54;
      const offsetCm = Math.max(0, (ctx.contentCm - imageWidthCm) / 2);
      return [
        blockParagraph({
          ctx,
          alignment: AlignmentType.LEFT,
          indent: { left: Math.round(offsetCm * 567) },
          spacing: {
            before: WORD_BODY.captionGapBeforePt * 20,
            after: (analysis?.story?.trim() ? WORD_BODY.captionGapAfterPt : WORD_BODY.gapBeforeStoryPt) * 20,
            line: WORD_BODY.captionLineTwips,
          },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.caption, { color: toDocxColor(WORD_COLORS.midGray) }),
              text: caption,
            }),
          ],
          lead,
          tailOfPage: isTail,
        }),
      ];
    }

    case 'story': {
      if (!analysis) return [];
      if (settings.includeStory === false || !analysis.story.trim()) return [];
      return [
        bodyParagraph(analysis.story, WORD_FONTS.storyBody, {
          firstLineTwips: WORD_BODY.storyFirstLineIndentTwips,
          lineTwips: Math.round(WORD_BODY.storyLineTwips * (settings.lineSpacing / 1.6)),
          spaceAfterPt: WORD_BODY.gapAfterStoryPt,
          pageBreakBefore: lead.pageBreakBefore,
          keepNext: ctx.sticky && !isTail,
        }),
      ];
    }

    case 'params': {
      if (!analysis?.params) return [];
      const cells = [
        { label: '焦段', value: tidyParam(analysis.params.focalLength, 'focal') },
        { label: '光圈', value: tidyParam(analysis.params.aperture, 'aperture') },
        { label: '快门', value: tidyParam(analysis.params.shutter, 'shutter') },
        { label: 'ISO', value: tidyParam(analysis.params.iso, 'iso') },
        { label: '调色', value: tidyParam(analysis.params.colorGrade, 'color') },
      ].filter((cell) => cell.value.trim().length > 0);
      if (cells.length === 0) return [];
      return [specTable(cells)];
    }

    case 'exif': {
      const exif = ctx.photo.exif;
      if (!exif) return [];
      const camera = formatCamera(exif);
      const lines: string[] = [];
      if (camera) lines.push(camera);
      const shot = formatExifLine(exif);
      if (shot) lines.push(shot);
      if (exif.takenAt) {
        const date = new Date(exif.takenAt);
        if (!Number.isNaN(date.getTime())) {
          const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
            date.getDate(),
          ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
          lines.push(stamp);
        }
      }
      if (lines.length === 0) return [];
      return [
        blockParagraph({
          ctx,
          alignment: AlignmentType.CENTER,
          spacing: { before: WORD_BODY.gapBeforeTechniquePt * 20, after: 40, line: 240 },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.caption, { color: toDocxColor(WORD_COLORS.midGray) }),
              text: lines.join('　·　'),
            }),
          ],
          lead,
          tailOfPage: isTail,
        }),
      ];
    }

    case 'score': {
      if (!analysis?.score) return [];
      return [scoreTable(analysis.score)];
    }

    case 'advice': {
      if (!analysis) return [];
      const groups: { label: string; items: string[] }[] = [
        { label: '为什么好', items: analysis.whyGood ?? [] },
        { label: '可以更好', items: analysis.improve ?? [] },
        { label: '下次这样拍', items: analysis.imitate ?? [] },
      ].filter((group) => group.items.length > 0);
      if (groups.length === 0) return [];
      return [adviceTable(groups)];
    }

    case 'technique': {
      if (!analysis || settings.includeTechnique === false) return [];
      const items = TECHNIQUE_ORDER.filter((key) => analysis.technique[key].trim().length > 0);
      if (items.length === 0) return [];
      const paragraphs: Paragraph[] = [
        blockParagraph({
          ctx,
          spacing: {
            before: WORD_BODY.gapBeforeTechniquePt * 20,
            after: WORD_BODY.gapAfterTechniquePt * 20,
            line: 240,
          },
          indent: { left: WORD_BODY.techniqueInsetTwips, right: WORD_BODY.techniqueInsetTwips },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.techniqueLabel, { color: toDocxColor(WORD_COLORS.midGray) }),
              text: '拍摄手法',
            }),
          ],
          lead,
        }),
      ];
      items.forEach((key, i) => {
        paragraphs.push(
          mixedBodyParagraph(
            [
              {
                text: TECHNIQUE_LABELS[key] + ' · ',
                spec: WORD_FONTS.techniqueLabel,
                color: WORD_COLORS.midGray,
              },
              { text: analysis.technique[key].trim(), spec: WORD_FONTS.techniqueBody, color: WORD_COLORS.nearBlack },
            ],
            {
              hangingTwips: WORD_BODY.techniqueHangingIndentTwips,
              lineTwips: WORD_BODY.techniqueLineTwips,
              spaceAfterPt: 2,
              insetTwips: WORD_BODY.techniqueInsetTwips,
              keepNext: ctx.sticky && !(isTail && i === items.length - 1),
            },
          ),
        );
      });
      return paragraphs;
    }

    case 'category': {
      const category = categoryOf(analysis);
      if (!category) return [];
      return [
        blockParagraph({
          ctx,
          alignment: AlignmentType.CENTER,
          spacing: { before: WORD_BODY.gapBeforeTagsPt * 20, after: 40, line: 240 },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.mood, { color: toDocxColor(WORD_COLORS.midGray) }),
              text: '类别：' + category,
            }),
          ],
          lead,
          tailOfPage: isTail,
        }),
      ];
    }

    case 'tags': {
      if (!analysis || settings.includeTags === false || analysis.tags.length === 0) return [];
      return [
        blockParagraph({
          ctx,
          alignment: AlignmentType.CENTER,
          spacing: { before: WORD_BODY.gapBeforeTagsPt * 20, after: 0, line: WORD_BODY.tagsLineTwips },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.tags, { color: toDocxColor(WORD_COLORS.midGray) }),
              text: analysis.tags.map((tag) => '#' + tag).join('  '),
            }),
          ],
          lead,
          tailOfPage: isTail,
        }),
      ];
    }

    case 'mood': {
      if (!analysis || settings.includeMood === false || !analysis.mood.trim()) return [];
      return [
        blockParagraph({
          ctx,
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 40, line: 240 },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.mood, { color: toDocxColor(WORD_COLORS.midGray) }),
              text: '氛围：' + analysis.mood.trim(),
            }),
          ],
          lead,
          tailOfPage: isTail,
        }),
      ];
    }

    case 'alt': {
      if (!analysis || settings.includeAlt === false || !analysis.alt.trim()) return [];
      return [
        blockParagraph({
          ctx,
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 40, line: 240 },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.alt, { color: toDocxColor(WORD_COLORS.lightGray) }),
              text: '无障碍：' + analysis.alt.trim(),
            }),
          ],
          lead,
          tailOfPage: isTail,
        }),
      ];
    }

    default:
      return [];
  }
}

/** 图片类别：没有独立字段，用 AI 给的第 1 个标签（没有就用氛围）当题材 */
function categoryOf(analysis?: PhotoAnalysis): string {
  if (!analysis) return '';
  const tag = analysis.tags?.[0]?.trim();
  if (tag) return tag;
  return analysis.mood?.trim() ?? '';
}

/* ------------------------- 0.3.2 模块化排版辅助 ------------------------- */

const specBorders: ITableBordersOptions = {
  top: { style: BorderStyle.SINGLE, size: 2, color: 'E6E2D9' },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E6E2D9' },
  left: { style: BorderStyle.SINGLE, size: 2, color: 'E6E2D9' },
  right: { style: BorderStyle.SINGLE, size: 2, color: 'E6E2D9' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'F0ECE4' },
  insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'F0ECE4' },
};

/** 参数条：一格一词，扫一眼就知道拍摄条件 */
function specTable(cells: { label: string; value: string }[]): Table {
  return new Table({
    width: { size: 85, type: WidthType.PERCENTAGE },
    indent: { size: WORD_BODY.techniqueInsetTwips, type: WidthType.DXA },
    borders: specBorders,
    rows: [
      new TableRow({
        cantSplit: true,
        children: cells.map(
          (cell) =>
            new TableCell({
              shading: { fill: 'FAF8F4', type: ShadingType.CLEAR, color: 'auto' },
              margins: { top: 90, bottom: 90, left: 120, right: 100 },
              children: [
                new Paragraph({
                  keepNext: true,
                  spacing: { before: 0, after: 30, line: 220 },
                  children: [
                    new TextRun({
                      ...buildRunStyle({ ...WORD_FONTS.techniqueBody, sizePt: 8, sizeHalfPt: 16 }, {
                        color: toDocxColor(WORD_COLORS.midGray),
                      }),
                      text: cell.label,
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 0, line: 240 },
                  children: [
                    new TextRun({
                      ...buildRunStyle({ ...WORD_FONTS.techniqueBody, sizePt: 9, sizeHalfPt: 18 }, {
                        color: toDocxColor(WORD_COLORS.nearBlack),
                      }),
                      text: cell.value,
                    }),
                  ],
                }),
              ],
            }),
        ),
      }),
    ],
  });
}

/** 评分卡：左边总分，右边六项 */
function scoreTable(score: NonNullable<PhotoAnalysis['score']>): Table {
  const rows: [string, number][] = [
    ['构图', score.breakdown.composition],
    ['光线', score.breakdown.lighting],
    ['调色', score.breakdown.color],
    ['主体', score.breakdown.subject],
    ['时机', score.breakdown.timing],
    ['技术', score.breakdown.technique],
  ];
  const left = rows.slice(0, 3).map(([k, v]) => k + ' ' + v.toFixed(1)).join('   ');
  const right = rows.slice(3).map(([k, v]) => k + ' ' + v.toFixed(1)).join('   ');

  return new Table({
    width: { size: 85, type: WidthType.PERCENTAGE },
    indent: { size: WORD_BODY.techniqueInsetTwips, type: WidthType.DXA },
    borders: specBorders,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE },
            shading: { fill: 'F3F0E8', type: ShadingType.CLEAR, color: 'auto' },
            margins: { top: 100, bottom: 100, left: 120, right: 80 },
            children: [
              new Paragraph({
                keepNext: true,
                spacing: { after: 0, line: 240 },
                children: [
                  new TextRun({
                    ...buildRunStyle({ ...WORD_FONTS.techniqueBody, sizePt: 20, sizeHalfPt: 40, bold: true }, {
                      color: toDocxColor(WORD_COLORS.nearBlack),
                    }),
                    text: score.overall.toFixed(1),
                  }),
                ],
              }),
              new Paragraph({
                spacing: { before: 20, after: 0, line: 220 },
                children: [
                  new TextRun({
                    ...buildRunStyle({ ...WORD_FONTS.techniqueBody, sizePt: 8, sizeHalfPt: 16 }, {
                      color: toDocxColor(WORD_COLORS.midGray),
                    }),
                    text: '总分 / 100',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 78, type: WidthType.PERCENTAGE },
            margins: { top: 120, bottom: 120, left: 160, right: 120 },
            children: [
              new Paragraph({
                keepNext: true,
                spacing: { after: 40, line: 240 },
                children: [
                  new TextRun({
                    ...buildRunStyle({ ...WORD_FONTS.techniqueBody, sizePt: 9, sizeHalfPt: 18 }, {
                      color: toDocxColor(WORD_COLORS.nearBlack),
                    }),
                    text: left,
                  }),
                ],
              }),
              new Paragraph({
                spacing: { after: 0, line: 240 },
                children: [
                  new TextRun({
                    ...buildRunStyle({ ...WORD_FONTS.techniqueBody, sizePt: 9, sizeHalfPt: 18 }, {
                      color: toDocxColor(WORD_COLORS.nearBlack),
                    }),
                    text: right,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** 三块建议并排成卡片表，避免一长串换行 */
function adviceTable(groups: { label: string; items: string[] }[]): Table {
  const widthPct = Math.floor(100 / groups.length);

  return new Table({
    width: { size: 85, type: WidthType.PERCENTAGE },
    indent: { size: WORD_BODY.techniqueInsetTwips, type: WidthType.DXA },
    borders: specBorders,
    rows: [
      new TableRow({
        cantSplit: true,
        children: groups.map(
          (group) =>
            new TableCell({
              width: { size: widthPct, type: WidthType.PERCENTAGE },
              shading: { fill: 'FAF8F4', type: ShadingType.CLEAR, color: 'auto' },
              margins: { top: 110, bottom: 110, left: 130, right: 110 },
              children: [
                new Paragraph({
                  keepNext: true,
                  spacing: { before: 0, after: 60, line: 220 },
                  children: [
                    new TextRun({
                      ...buildRunStyle({ ...WORD_FONTS.techniqueLabel, sizePt: 8.5, sizeHalfPt: 17 }, {
                        color: toDocxColor(WORD_COLORS.midGray),
                      }),
                      text: group.label,
                    }),
                  ],
                }),
                ...group.items.map(
                  (item, i) =>
                    new Paragraph({
                      keepNext: i < group.items.length - 1,
                      spacing: { before: 0, after: 40, line: 250 },
                      children: [
                        new TextRun({
                          ...buildRunStyle({ ...WORD_FONTS.techniqueBody, sizePt: 9, sizeHalfPt: 18 }, {
                            color: toDocxColor(WORD_COLORS.nearBlack),
                          }),
                          text: '· ' + item,
                        }),
                      ],
                    }),
                ),
              ],
            }),
        ),
      }),
    ],
  });
}