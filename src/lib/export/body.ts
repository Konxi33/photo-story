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
import { formatExifLine } from '@/lib/image/exif';
import type { ExportSettings, Photo, Technique } from '@/types/domain';

import { buildRunStyle } from './fonts';
import { fitIntoFrame, type EncodedImage } from './image-encode';
import { exportContentCm, exportContentHeightCm, exportFrameCm } from './metrics';
import {
  bodyParagraph,
  dividerParagraph,
  mixedBodyParagraph,
  pageBreakParagraph,
} from './paragraphs';

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

/**
 * 0.5.4：图片下方的一行图注——「图 03 · 1/320s · f/1.8 · ISO 400 · 24mm」
 * 打印成册后这种小字最能出效果。优先用真实 EXIF，没有就退回 AI 写的参数，都没有就只留编号。
 */
/**
 * 没有 EXIF 时用 AI 猜的参数兜底。模型写出来的是「推测 14mm」「ISO ISO 400」这类
 * 自由文本，直接拼在图注里既重复又不像印刷品，所以在这里统一规格化。
 */
export function tidyParam(raw: unknown, kind: 'focal' | 'aperture' | 'shutter' | 'iso' | 'color'): string {
  let value = (raw ?? '').toString().trim();
  if (!value) return '';
  if (kind !== 'color') {
    value = value.replace(/^(推测|推断|估计|估算|约|大约|大概|可能是|可能)\s*/u, '').trim();
  }
  if (kind === 'focal') {
    const match = value.match(/\d+(?:\.\d+)?/);
    return match ? match[0] + 'mm' : '';
  }
  if (kind === 'aperture') {
    const match = value.match(/\d+(?:\.\d+)?/);
    return match ? 'f/' + match[0] : '';
  }
  if (kind === 'shutter') {
    const match = value.match(/\d+(?:\/\d+)?/);
    return match ? match[0] + 's' : '';
  }
  if (kind === 'iso') {
    const match = value.match(/\d{2,6}/);
    return match ? 'ISO ' + match[0] : '';
  }
  return value;
}

/**
 * 图注。0.5.5：改成摄影书口径——编号 + 标题（参数移进书末「技术附录」）。
 * 理由：真实摄影书的图注写「Plate 12 · 标题 · 年份 · 地点」，器材参数统一
 * 放在书末附录，不然每页都挂一串 1/320s f/1.8 ISO 400，翻起来像说明书。
 */
function buildImageCaption(photo: Photo, index: number, style: 'title' | 'param' | 'both'): string {
  const label = '图 ' + String(index).padStart(2, '0');
  const title = (photo.status === 'success' ? photo.analysis?.title : '')?.trim() || '';
  const paramText = buildParamLine(photo);

  if (style === 'param') return paramText ? label + ' · ' + paramText : label;
  if (style === 'both') {
    const parts = [title, paramText].filter(Boolean);
    return parts.length > 0 ? label + ' · ' + parts.join(' · ') : label;
  }
  return title ? label + ' · ' + title : paramText ? label + ' · ' + paramText : label;
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

export function buildPhotoSection(params: PhotoSectionParams): (Paragraph | Table)[] {
  const { photo, index, image, settings, isFirst } = params;
  const analysis = photo.status === 'success' ? photo.analysis : undefined;

  const blocks: (Paragraph | Table)[] = [];

  if (!isFirst && settings.pageBreakPerPhoto) blocks.push(pageBreakParagraph());

  if (settings.showIndex) {
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        spacing: { before: 0, after: WORD_BODY.gapAfterIndexPt * 20, line: 240, lineRule: 'auto' },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.sectionIndex, {
              color: toDocxColor(WORD_COLORS.lightGray),
            }),
            text: String(index).padStart(2, '0'),
          }),
        ],
      }),
    );
  }

  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 0, after: WORD_BODY.gapAfterTitlePt * 20, line: 288, lineRule: 'auto' },
      children: [
        new TextRun({
          ...buildRunStyle(WORD_FONTS.sectionTitle, {
            color: toDocxColor(WORD_COLORS.nearBlack),
          }),
          text: analysis?.title || photo.fileName,
        }),
      ],
    }),
  );

  const contentCm = exportContentCm(settings);

  blocks.push(
    dividerParagraph(Math.min(WORD_BODY.dividerWidthCm, contentCm), {
      color: WORD_COLORS.lineBeige,
      sizeEighths: WORD_BODY.dividerSizeEighths,
      contentWidthCm: contentCm,
    }),
  );

  if (image) {
    const baseFrame = exportFrameCm(settings);

    // 0.5.4：改成「按实际内容算高度预算」，不再用拍脑袋的系数。
    // 一页可用高度 = 章头(可选) + 标题/分隔线 + 图片 + 图注 + 正文各块 + 间距，
    // 图片能占多少，就是剩下的那些 —— 只有这样印出来才不会出现「拍摄手法尾巴单独占一页」。
    const lineCm = 0.6; // 10.5pt × 1.6 行距 ≈ 0.6cm
    const charsPerLine = Math.max(18, Math.round(contentCm / 0.38)); // 10.5pt 中文 ≈ 0.38cm/字
    const storyText = analysis?.story?.trim() ?? '';
    const storyCm = storyText ? Math.ceil(storyText.length / charsPerLine) * lineCm + 0.4 : 0;
    const techniqueLines = analysis
      ? TECHNIQUE_ORDER.filter((key) => analysis.technique[key].trim().length > 0).length
      : 0;
    const techniqueCm = techniqueLines > 0 ? techniqueLines * 0.6 + 0.95 : 0;
    const listItems =
      (analysis?.whyGood?.length ?? 0) + (analysis?.improve?.length ?? 0) + (analysis?.imitate?.length ?? 0);
    const listCm = settings.includeScoreDetail && listItems > 0 ? listItems * 0.5 + 0.5 : 0;
    // 「参数表 + 评分卡 + 三块建议」是同一整块解读内容，实测占 6.2cm。
    // 以前按 1.4cm 估，于是图片被算得太大，最后几行必然溢到下一页（LibreOffice 实测 20 张照片排出 44 页）。
    const detailCm = settings.includeTechnique && settings.includeScoreDetail ? 6.2 : 0;
    // 标签行常常要折成两行（5 个 #标签 排不满一行就会换行），按两行算。
    const tagsCm = analysis?.tags?.length ? 1.15 : 0;
    const headingCm =
      // 紧凑章头实测约 2.6cm（章号一行 + 章名一行 + 间距），别再按 5.2 高估，
      // 否则每页都白白少给图片 2cm。
      (params.hasChapterHeading ? 2.9 : 0) +
      0.9 + // 照片序号
      0.9 + // 标题
      0.4; // 分隔线
    const textCm = storyCm + techniqueCm + listCm + detailCm + tagsCm;
    const captionCm = settings.captionUnderImage !== false ? 0.6 : 0;
    // 3.6 而不再是 2.4：LibreOffice/Word 的行高会随字体替换浮动，留 1 行余量才不会让
    // 「标签」这种一两行的尾巴单独掉到下一页（实测 2.4cm 时正好差一行）。
    const roomCm = exportContentHeightCm(settings) - headingCm - textCm - captionCm - 3.6;

    const textLoad =
      (analysis?.story?.length ?? 0) / 90 +
      (analysis?.technique ? 1.2 : 0) +
      (settings.includeScoreDetail ? listItems * 0.35 + (analysis?.score ? 0.8 : 0) : 0);
    const shrink = Math.min(2.2, Math.max(0, textLoad - 1.6));
    // 竖图给更高的框（横框是按横图设计的，2:3 的竖图塞进去只有 7cm 宽，印在 A4 上偏小），
    // 但上限受 roomCm 约束；文字特别多时退回原框，宁可图小也别把正文拆到下一页。
    const isPortrait = image.height > image.width;
    // 下限从 10cm 放到 8cm：文字特别多时宁肯图小一点，也别把「标签」这种一两行的尾巴
    // 挤到下一页去（渲染实测：10cm 的图 + 5 行拍摄手法正好把页占满，标签单独占一页）。
    const portraitCap = Math.min(
      Math.max(roomCm, 8),
      baseFrame.heightCm + 3.2,
      exportContentHeightCm(settings) * 0.58,
    );
    const frame = isPortrait
      ? { widthCm: baseFrame.widthCm, heightCm: portraitCap }
      : { widthCm: baseFrame.widthCm, heightCm: Math.max(8, Math.min(baseFrame.heightCm - shrink, Math.max(8, roomCm))) };
    const size = fitIntoFrame(image, frame);

    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        // 0.5.4：图与下面的图注、正文粘在一起，避免「图在这页、图注跑到下页」
        keepNext: true,
        spacing: {
          before: WORD_BODY.gapAfterImagePt * 20,
          after: 0,
          line: 240,
          lineRule: 'auto',
        },
        children: [
          new ImageRun({
            type: 'jpg',
            data: image.data,
            transformation: { width: size.widthPx, height: size.heightPx },
          }),
        ],
      }),
    );

    // 0.5.4：图片下面一行小字图注；0.5.5 改成摄影书口径：
    // 左对齐（与图片左边线齐平）、离图约 5mm、8.5pt 中灰。
    if (settings.captionUnderImage !== false) {
      const caption = buildImageCaption(photo, index, settings.captionStyle ?? 'title');
      if (caption) {
        // 图片是居中的，图注要跟图片左边线对齐，而不是跟版心左边线对齐
        const imageWidthCm = (size.widthPx / 96) * 2.54;
        const offsetCm = Math.max(0, (exportContentCm(settings) - imageWidthCm) / 2);
        blocks.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            indent: { left: Math.round(offsetCm * 567) },
            keepNext: Boolean(analysis?.story?.trim()),
            spacing: {
              before: WORD_BODY.captionGapBeforePt * 20,
              after: (analysis?.story?.trim() ? WORD_BODY.captionGapAfterPt : WORD_BODY.gapBeforeStoryPt) * 20,
              line: WORD_BODY.captionLineTwips,
              lineRule: 'auto',
            },
            children: [
              new TextRun({
                ...buildRunStyle(WORD_FONTS.caption, {
                  color: toDocxColor(WORD_COLORS.midGray),
                }),
                text: caption,
              }),
            ],
          }),
        );
      }
    }
  }

  if (!analysis) {
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: WORD_BODY.storyLineTwips, lineRule: 'auto' },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.storyBody, {
              color: toDocxColor(WORD_COLORS.lightGray),
            }),
            text: '（待补充）',
          }),
        ],
      }),
    );
    return blocks;
  }

  if (settings.includeStory && analysis.story.trim()) {
    blocks.push(
      bodyParagraph(analysis.story, WORD_FONTS.storyBody, {
        firstLineTwips: WORD_BODY.storyFirstLineIndentTwips,
        lineTwips: Math.round(WORD_BODY.storyLineTwips * (settings.lineSpacing / 1.6)),
        spaceAfterPt: WORD_BODY.gapAfterStoryPt,
      }),
    );
  }

  // 0.3.2：拍摄参数做成 5 格小表（模块化，比一行文字更好扫读）
  if (settings.includeTechnique && settings.includeScoreDetail && analysis.params) {
    const cells = [
      { label: '焦段', value: tidyParam(analysis.params.focalLength, 'focal') },
      { label: '光圈', value: tidyParam(analysis.params.aperture, 'aperture') },
      { label: '快门', value: tidyParam(analysis.params.shutter, 'shutter') },
      { label: 'ISO', value: tidyParam(analysis.params.iso, 'iso') },
      { label: '调色', value: tidyParam(analysis.params.colorGrade, 'color') },
    ].filter((cell) => cell.value && cell.value.trim().length > 0);

    if (cells.length > 0) {
      blocks.push(specTable(cells));
    }
  }

  // 0.3.2：评分卡（总分 + 六项权重）
  if (settings.includeTechnique && settings.includeScoreDetail && analysis.score) {
    const s = analysis.score;
    const rows: [string, number][] = [
      ['构图', s.breakdown.composition],
      ['光线', s.breakdown.lighting],
      ['调色', s.breakdown.color],
      ['主体', s.breakdown.subject],
      ['时机', s.breakdown.timing],
      ['技术', s.breakdown.technique],
    ];
    const left = rows
      .slice(0, 3)
      .map(([k, v]) => k + ' ' + v.toFixed(1))
      .join('   ');
    const right = rows
      .slice(3)
      .map(([k, v]) => k + ' ' + v.toFixed(1))
      .join('   ');

    blocks.push(
      new Table({
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
                    spacing: { after: 0, line: 240, lineRule: 'auto' },
                    children: [
                      new TextRun({
                        ...buildRunStyle({ ...WORD_FONTS.techniqueBody, sizePt: 20, sizeHalfPt: 40, bold: true }, {
                          color: toDocxColor(WORD_COLORS.nearBlack),
                        }),
                        text: s.overall.toFixed(1),
                      }),
                    ],
                  }),
                  new Paragraph({
                    spacing: { before: 20, after: 0, line: 220, lineRule: 'auto' },
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
                    spacing: { after: 40, line: 240, lineRule: 'auto' },
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
                    spacing: { after: 0, line: 240, lineRule: 'auto' },
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
      }),
    );
  }

  // 0.3.2：三块建议——并排三列卡片（0.5.4 起跟评分卡一起归入「解读」开关）
  if (settings.includeTechnique && settings.includeScoreDetail) {
    const groups: { label: string; items: string[] }[] = [
      { label: '为什么好', items: analysis.whyGood ?? [] },
      { label: '可以更好', items: analysis.improve ?? [] },
      { label: '下次这样拍', items: analysis.imitate ?? [] },
    ].filter((group) => group.items.length > 0);

    if (groups.length > 0) {
      blocks.push(adviceTable(groups));
    }
  }


  if (settings.includeTechnique) {
    const items = TECHNIQUE_ORDER.filter((key) => analysis.technique[key].trim().length > 0);

    if (items.length > 0) {
      blocks.push(
        new Paragraph({
          keepNext: true,
          indent: { left: WORD_BODY.techniqueInsetTwips, right: WORD_BODY.techniqueInsetTwips },
          spacing: {
            before: WORD_BODY.gapBeforeTechniquePt * 20,
            after: WORD_BODY.gapAfterTechniquePt * 20,
            line: 240,
            lineRule: 'auto',
          },
          children: [
            new TextRun({
              ...buildRunStyle(WORD_FONTS.techniqueLabel, {
                color: toDocxColor(WORD_COLORS.midGray),
              }),
              text: '拍摄手法',
            }),
          ],
        }),
      );

      for (const key of items) {
        blocks.push(
          mixedBodyParagraph(
            [
              {
                text: TECHNIQUE_LABELS[key] + ' · ',
                spec: WORD_FONTS.techniqueLabel,
                color: WORD_COLORS.midGray,
              },
              {
                text: analysis.technique[key].trim(),
                spec: WORD_FONTS.techniqueBody,
                color: WORD_COLORS.nearBlack,
              },
            ],
            {
              hangingTwips: WORD_BODY.techniqueHangingIndentTwips,
              lineTwips: WORD_BODY.techniqueLineTwips,
              spaceAfterPt: 2,
              // 0.5.4：拍摄手法收窄成中间一栏，和图片的左右边距对齐，打印更像画册
              insetTwips: WORD_BODY.techniqueInsetTwips,
            },
          ),
        );
      }
    }
  }

  if (settings.includeTags && analysis.tags.length > 0) {
    blocks.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: {
          before: WORD_BODY.gapBeforeTagsPt * 20,
          after: 0,
          line: WORD_BODY.tagsLineTwips,
          lineRule: 'auto',
        },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.tags, { color: toDocxColor(WORD_COLORS.midGray) }),
            text: analysis.tags.map((tag) => '#' + tag).join('  '),
          }),
        ],
      }),
    );
  }

  if (settings.includeMood && analysis.mood.trim()) {
    blocks.push(centeredLine('氛围：' + analysis.mood.trim(), WORD_FONTS.mood, WORD_COLORS.midGray));
  }

  if (settings.includeAlt && analysis.alt.trim()) {
    blocks.push(
      centeredLine('无障碍：' + analysis.alt.trim(), WORD_FONTS.alt, WORD_COLORS.lightGray),
    );
  }

  return blocks;
}

function centeredLine(
  text: string,
  spec: (typeof WORD_FONTS)[keyof typeof WORD_FONTS],
  color: string,
): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 40, line: 240, lineRule: 'auto' },
    children: [new TextRun({ ...buildRunStyle(spec, { color: toDocxColor(color) }), text })],
  });
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
                  spacing: { before: 0, after: 30, line: 220, lineRule: 'auto' },
                  children: [
                    new TextRun({
                      ...buildRunStyle(
                        { ...WORD_FONTS.techniqueBody, sizePt: 8, sizeHalfPt: 16 },
                        { color: toDocxColor(WORD_COLORS.midGray) },
                      ),
                      text: cell.label,
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' },
                  children: [
                    new TextRun({
                      ...buildRunStyle(
                        { ...WORD_FONTS.techniqueBody, sizePt: 9, sizeHalfPt: 18 },
                        { color: toDocxColor(WORD_COLORS.nearBlack) },
                      ),
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
                  spacing: { before: 0, after: 60, line: 220, lineRule: 'auto' },
                  children: [
                    new TextRun({
                      ...buildRunStyle(
                        { ...WORD_FONTS.techniqueLabel, sizePt: 8.5, sizeHalfPt: 17 },
                        { color: toDocxColor(WORD_COLORS.midGray) },
                      ),
                      text: group.label,
                    }),
                  ],
                }),
                ...group.items.map(
                  (item) =>
                    new Paragraph({
                      spacing: { before: 0, after: 40, line: 250, lineRule: 'auto' },
                      children: [
                        new TextRun({
                          ...buildRunStyle(
                            { ...WORD_FONTS.techniqueBody, sizePt: 9, sizeHalfPt: 18 },
                            { color: toDocxColor(WORD_COLORS.nearBlack) },
                          ),
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