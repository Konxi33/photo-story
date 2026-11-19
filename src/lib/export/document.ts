// src/lib/export/document.ts
'use client';

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  PageNumber,
  Paragraph,
  TextRun,
  type ISectionOptions,
  type Table,
} from 'docx';

import {
  CM_TO_TWIPS,
  WORD_COLORS,
  WORD_FOOTER,
  WORD_FONTS,
  WORD_HEADER,
  WORD_PAGE,
  WORD_PAPER,
  toDocxColor,
} from '@/config/wordLayout';
import type { ExportSettings, Photo, Project } from '@/types/domain';

import { buildAppendix } from './appendix';
// 0.6.1：流式排版（buildPhotoSection）已不再用于导出 —— 它保证不了「一张图和它的文字不跨页」。
// 所有单页现在都走 buildGridPhotoSection（12×24 网格表），需要老观感时由 resolveLayout 折成竖排网格。
import { buildGridPhotoSection } from './word-grid';
import { buildChapterHeading, buildChapterOpener, planChapters, type ChapterPlan } from './chapter';
import { buildCoverSection } from './cover';
import { buildRunFont, buildRunStyle } from './fonts';
import type { EncodedImage } from './image-encode';
import { exportContentCm, exportContentHeightCm } from './metrics';
import { buildOverviewSection, planOverviewGrid } from './overview';
import { collapsePageBreaks } from './paragraphs';

export interface BuildDocumentParams {
  project: Project;
  photos: Photo[];
  images: Map<string, EncodedImage>;
  thumbs: Map<string, EncodedImage>;
  coverImage?: EncodedImage;
  settings: ExportSettings;
  exportDate: Date;
  /** 0.5.2：编排台排好的章节；为空时按原来的平铺顺序导出 */
  chapters?: { id: string; title: string; note: string; photoIds: string[] }[];
}

export function buildDocument(params: BuildDocumentParams): Document {
  const { project, photos, images, thumbs, coverImage, settings, exportDate, chapters } = params;

  // 0.5.4：封面单独成节 —— 这样封面不参与页码，正文第一页才从「第 1 页」开始，
  // 打印装订出来更正式；封面节也不印页眉。
  const coverChildren: (Paragraph | Table)[] = [];
  if (settings.includeCover) {
    coverChildren.push(
      ...buildCoverSection({
        projectName: project.name,
        coverImage,
        photoCount: photos.length,
        exportDate,
        // 节分隔本身就会另起一页，封面里不能再补一个分页，否则多出一页空白
        endWithBreak: false,
        contentWidthCm: exportContentCm(settings),
      }),
    );
  }

  const children: (Paragraph | Table)[] = [];
  let hasPreviousContent = false;

  const chapterPlan: ChapterPlan[] =
    chapters && chapters.length > 0 ? planChapters(photos, chapters).plan : [];

  if (settings.includeOverview && photos.length > 0) {
    // 0.5.4：按可用高度反推网格，能让全部照片挤进一页就挤进去（打印别浪费纸），
    // 用户选的列数只作为下限/起点。
    const grid = planOverviewGrid({
      count: photos.length,
      contentWidthCm: exportContentCm(settings),
      contentHeightCm: exportContentHeightCm(settings),
      minColumns: settings.overviewColumns,
      maxColumns: 6,
    });

    children.push(
      ...buildOverviewSection({
        photos,
        images: thumbs,
        columns: grid.columns,
        exportDate,
        rowsPerPage: grid.rowsPerPage,
        rowGapPt: grid.rowGapPt,
        contentWidthCm: exportContentCm(settings),
        // 后面紧跟章节扉页时，扉页自己会分页，总览页就别再补一个（否则多一页白纸）
        endWithBreak: chapterPlan.length === 0,
      }),
    );
    hasPreviousContent = true;
  }

  const plannedIds = new Set(chapterPlan.flatMap((entry) => entry.photos.map((p) => p.id)));
  const restPhotos = chapterPlan.length > 0 ? photos.filter((p) => !plannedIds.has(p.id)) : photos;

  let photoIndex = 0;
  // 导出顺序里的照片（章节顺序 + 未编排尾巴），技术附录按这个顺序编号
  const ordered: Photo[] = [];

  /**
   * 0.6.1：**一律走网格渲染**。
   * 起因是用户实测两件事：①默认模板（竖排流式）会出现「图在这页、说明跑到下一页」；
   * ②自己摆的版式里文字超出格子、多的字塞不下。
   * 网格页是「一张 12×24 的表格 + 不跨行」，天然不会把一张照片和它的文字拆到两页；
   * 放不下时 `planLayoutPage` 会先缩字号、再让照片腾行，最后才截断。
   * 没有 `settings.grid` 的老项目用 `resolveLayout()` 折成竖排网格，观感与旧版接近。
   */
  const contentCm = exportContentCm(settings);
  const fullHeightCm = exportContentHeightCm(settings);

  const photoPage = (
    photo: Photo,
    index: number,
    opts: { isFirst: boolean; hasChapterHeading?: boolean; heading?: (Paragraph | Table)[] },
  ): (Paragraph | Table)[] => {
    const image = images.get(photo.id) ?? null;
    return buildGridPhotoSection({
      photo,
      index,
      image,
      settings,
      contentCm,
      // 0.6.1：章头高度由 word-grid 自己扣（它得知道这一页顶上有没有章头），
      // 所以章头必须作为 `heading` 传进去，不能在外面单独 push —— 否则
      // 表格按整页高排、章头再压在顶上，两者相加超出页高，LibreOffice 会把
      // 整块推到下一页，结果每章多一张白页（实测 20 张照片印成 37 页）。
      contentHeightCm: fullHeightCm,
      heading: opts.heading,
      pageBreakBefore: !opts.isFirst,
    });
  };

  chapterPlan.forEach((entry, chapterIdx) => {
    // 章扉要占一整页，只留给「照片够多、值得单独开一个单元」的章节（≥4 张）。
    // 一张或两三张的小章节用紧凑章头压在同一页顶端，否则一本 20 张的书会被扉页切成碎片
    // —— 摄影书里这也是常见做法：小章做「节」，大章才做「章」。
    const compact = entry.photos.length <= 3;

    if (compact) {
      // 0.6.1：章头不再单独 push 进 children，而是随第一张照片一起交给
      // word-grid —— 只有它知道这页顶上占了多少高度，才能把 12×24 表格
      // 压到「章头 + 照片页 ≤ 一页」以内。否则每章都会多出一张白页。
      const heading = buildChapterHeading({
        index: chapterIdx + 1,
        title: entry.chapter.title,
        note: entry.chapter.note,
        contentWidthCm: exportContentCm(settings),
      });
      hasPreviousContent = true;

      entry.photos.forEach((photo, i) => {
        photoIndex += 1;
        ordered.push(photo);
        children.push(
          ...photoPage(photo, photoIndex, {
            // 章头已经把这页开好了，第一张照片别再分一次页
            isFirst: i === 0,
            hasChapterHeading: i === 0,
            heading: i === 0 ? heading : undefined,
          }),
        );
      });
      return;
    }

    const hasPhotosAfter = entry.photos.length > 0 || restPhotos.length > 0;
    children.push(
      ...buildChapterOpener({
        index: chapterIdx + 1,
        title: entry.chapter.title,
        note: entry.chapter.note,
        hasPreviousContent,
        // 空章且后面还有内容时不再额外分页，避免多出一页白纸
        endWithBreak: hasPhotosAfter,
        contentWidthCm: exportContentCm(settings),
        contentHeightCm: exportContentHeightCm(settings),
      }),
    );
    hasPreviousContent = true;

    entry.photos.forEach((photo) => {
      photoIndex += 1;
      ordered.push(photo);
      children.push(
        ...photoPage(photo, photoIndex, { isFirst: false }),
      );
    });
  });

  // 没有编进任何章节的照片，按原顺序接在最后，不悄悄丢片
  restPhotos.forEach((photo) => {
    photoIndex += 1;
    ordered.push(photo);
    children.push(
      ...photoPage(photo, photoIndex, { isFirst: photoIndex === 1 && !hasPreviousContent }),
    );
  });

  // 0.5.5：图注不再挂一串参数，参数统一收到书末技术附录（真实摄影书的做法）。
  // captionStyle === 'both' 时参数已经在图注里，就不再重复印一遍。
  if (settings.includeTechnique !== false && (settings.captionStyle ?? 'title') !== 'both' && ordered.length > 0) {
    children.push(
      ...buildAppendix({
        photos: ordered,
        contentWidthCm: exportContentCm(settings),
        contentHeightCm: exportContentHeightCm(settings),
      }),
    );
  }

  return new Document({
    creator: '照片故事',
    title: project.name,
    description: photos.length + ' 张照片的照片故事',
    styles: {
      default: {
        document: {
          run: {
            font: buildRunFont(WORD_FONTS.storyBody),
            size: WORD_FONTS.storyBody.sizeHalfPt,
            color: toDocxColor(WORD_COLORS.nearBlack),
          },
        },
      },
    },
    sections: [
      ...(coverChildren.length > 0
        ? [
            buildSection({
              project,
              settings,
              children: collapsePageBreaks(coverChildren),
              variant: 'cover',
            }),
          ]
        : []),
      buildSection({
        project,
        settings,
        // 0.5.4：章节扉页自带分页，紧接着的照片又按 pageBreakPerPhoto 分一次，
        // 会在打印稿里印出整张空白页 —— 连续的重复分页在这里统一去掉。
        children: collapsePageBreaks(children),
        variant: 'body',
      }),
    ],
  });
}

function buildSection(params: {
  project: Project;
  settings: ExportSettings;
  children: (Paragraph | Table)[];
  /** cover = 封面节：不印页眉页脚、不计页码；body = 正文节：页码从 1 开始 */
  variant: 'cover' | 'body';
}): ISectionOptions {
  const { project, settings, children, variant } = params;
  const isCover = variant === 'cover';

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: WORD_HEADER.borderSizeEighths,
            color: toDocxColor(WORD_HEADER.borderColor),
            space: 1,
          },
        },
        spacing: { before: 0, after: 80, line: 240, lineRule: 'auto' },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.header, {
              color: toDocxColor(WORD_HEADER.color),
            }),
            text: project.name,
          }),
        ],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: WORD_FOOTER.lineTwips, lineRule: 'auto' },
        children: [
          new TextRun({
            ...buildRunStyle(WORD_FONTS.footer, {
              color: toDocxColor(WORD_FOOTER.color),
            }),
            // 0.5.4：只印「第 N 页」。NUMPAGES 在 LibreOffice/Word 里会把末尾的空节
            // 也算进去（实测 27 页的稿子印出「共 28 页」），印错数字比不印更难看。
            children: ['第 ', PageNumber.CURRENT, ' 页'],
          }),
        ],
      }),
    ],
  });

  const blank = new Header({
    children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
  });
  const blankFooter = new Footer({
    children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
  });

  // 0.3.0：方向 / 页边距 / 分栏；0.5.4：纸张（A4/A5）与装订线
  const paper = WORD_PAPER[settings.paperSize ?? 'a4'] ?? WORD_PAPER.a4;
  const landscape = settings.orientation === 'landscape';
  const marginCm = settings.margins === 'narrow' ? 1.6 : settings.margins === 'wide' ? 3.0 : 2.2;
  const marginTwips = CM_TO_TWIPS(marginCm);
  const gutterCm = settings.gutter ?? 0;
  const gutterTwips = CM_TO_TWIPS(gutterCm);

  return {
    properties: {
      // 封面节不参与页码；正文节从 1 开始，且首页也照常印页眉
      titlePage: false,
      column: settings.bodyColumns === 2 ? { count: 2, space: 420 } : undefined,
      page: {
        size: {
          width: landscape ? paper.heightTwips : paper.widthTwips,
          height: landscape ? paper.widthTwips : paper.heightTwips,
        },
        margin: {
          top: marginTwips,
          right: marginTwips,
          bottom: marginTwips,
          // 装订线：左侧多留白，正文不变形（不镜像，只加宽左边）
          left: marginTwips + gutterTwips,
          gutter: gutterTwips,
          header: WORD_PAGE.headerDistanceTwips,
          footer: WORD_PAGE.footerDistanceTwips,
        },
        // 只在正文节重排页码，封面节保持默认（不显示页码所以无所谓）
        pageNumbers: isCover ? undefined : { start: 1 },
      },
    },
    // 封面节：干净的一张封面，不要页眉页脚
    headers: isCover
      ? { default: blank }
      : settings.showHeader
        ? { default: header }
        : { default: blank },
    footers: isCover ? { default: blankFooter } : { default: footer },
    children,
  };
}
