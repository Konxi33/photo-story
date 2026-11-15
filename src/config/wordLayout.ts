// src/config/wordLayout.ts
// Word 排版的全部数值。改版式只动这个文件，不要在其他模块里写死尺寸。

export const CM_TO_TWIPS = (cm: number): number => Math.round((cm / 2.54) * 1440);
export const CM_TO_PX96 = (cm: number): number => Math.round((cm / 2.54) * 96);
export const PT_TO_HALF_POINT = (pt: number): number => Math.round(pt * 2);

export const WORD_PAGE = {
  widthCm: 21,
  heightCm: 29.7,
  widthTwips: 11906,
  heightTwips: 16838,
  marginTopCm: 2.2,
  marginBottomCm: 2.2,
  marginLeftCm: 2.2,
  marginRightCm: 2.2,
  marginTopTwips: CM_TO_TWIPS(2.2),
  marginBottomTwips: CM_TO_TWIPS(2.2),
  marginLeftTwips: CM_TO_TWIPS(2.2),
  marginRightTwips: CM_TO_TWIPS(2.2),
  headerDistanceTwips: CM_TO_TWIPS(1.25),
  footerDistanceTwips: CM_TO_TWIPS(1.25),
  contentWidthCm: 16.6,
  contentHeightCm: 25.3,
} as const;

/**
 * 0.5.4：打印用纸张尺寸（twips，1cm = 567twips）。
 * 只列国内打印常见的两种：A4 与 A5（A5 常用来做小册子）。
 */
export const WORD_PAPER = {
  a4: { label: 'A4', widthTwips: 11906, heightTwips: 16838, widthCm: 21, heightCm: 29.7 },
  a5: { label: 'A5', widthTwips: 8391, heightTwips: 11906, widthCm: 14.8, heightCm: 21.0 },
} as const;

export type WordPaperSize = keyof typeof WORD_PAPER;

/** 纸张可排正文宽度（cm）= 纸宽 - 左右页边距 - 装订线 */
export function contentWidthCm(
  paper: WordPaperSize,
  marginCm: number,
  gutterCm: number,
): number {
  return Math.max(6, WORD_PAPER[paper].widthCm - marginCm * 2 - gutterCm);
}


export const WORD_COVER = {
  topSpacerCm: 5.0,
  titleSizePt: 26,
  titleSizeHalfPt: PT_TO_HALF_POINT(26),
  titleCompactMaxChars: 20,
  titleCompactSizePt: 22,
  titleCompactSizeHalfPt: PT_TO_HALF_POINT(22),

  subtitleSizePt: 12,
  subtitleSizeHalfPt: PT_TO_HALF_POINT(12),

  footerSizePt: 10.5,
  footerSizeHalfPt: PT_TO_HALF_POINT(10.5),

  dividerWidthCm: 4.0,
  dividerWidthTwips: CM_TO_TWIPS(4.0),
  dividerSizeEighths: 6,
  imageMaxWidthCm: 15.5,
  imageMaxHeightCm: 11.5,
  imageEmbedEdgePx: 1400,
  gapBeforeImageCm: 1.2,
  gapAfterImageCm: 1.2,

  titleLineTwips: 288,
  subtitleLineTwips: 312,
} as const;

export const WORD_OVERVIEW = {
  columns: 3,
  columnsMin: 2,
  columnsMax: 3,
  rowsPerPage: 3,
  columnWidthCm: 5.53,
  columnWidthTwips: CM_TO_TWIPS(5.53),
  rowHeightCm: 5.0,
  rowHeightTwips: CM_TO_TWIPS(5.0),
  /** 总览网格里相邻两行之间的间距（pt） */
  rowGapBeforePt: 8,

  thumbWidthCm: 4.9,
  /** 3:2 —— 打印时总览缩略图统一裁成横构图，排成整齐的方阵 */
  thumbAspect: 1.5,
  thumbHeightCm: 3.0,
  thumbEmbedEdgePx: 400,

  captionSizePt: 8.5,
  captionSizeHalfPt: PT_TO_HALF_POINT(8.5),
  captionMaxChars: 14,

  cellPaddingCm: 0.15,
  cellPaddingTwips: CM_TO_TWIPS(0.15),

  titleSizePt: 18,
  titleSizeHalfPt: PT_TO_HALF_POINT(18),
  metaSizePt: 10,
  metaSizeHalfPt: PT_TO_HALF_POINT(10),
} as const;

export const WORD_BODY = {
  indexSizePt: 10,
  indexSizeHalfPt: PT_TO_HALF_POINT(10),

  titleSizePt: 18,
  titleSizeHalfPt: PT_TO_HALF_POINT(18),

  dividerWidthCm: 2.5,
  dividerWidthTwips: CM_TO_TWIPS(2.5),
  dividerSizeEighths: 6,

  frameCompact: { widthCm: 14.5, heightCm: 12.0 },
  frameLoose: { widthCm: 14.5, heightCm: 15.0 },

  storySizePt: 11.5,
  storySizeHalfPt: PT_TO_HALF_POINT(11.5),
  storyLineMultiple: 1.6,
  storyLineTwips: 384,
  storyFirstLineIndentTwips: 460,

  techniqueTitleSizePt: 10.5,
  techniqueTitleSizeHalfPt: PT_TO_HALF_POINT(10.5),
  techniqueSizePt: 10.5,
  techniqueSizeHalfPt: PT_TO_HALF_POINT(10.5),
  techniqueLineTwips: 336,
  techniqueHangingIndentCm: 1.2,
  techniqueHangingIndentTwips: CM_TO_TWIPS(1.2),

  tagsSizePt: 10,
  tagsSizeHalfPt: PT_TO_HALF_POINT(10),
  tagsLineTwips: 288,
  moodSizePt: 10,
  moodSizeHalfPt: PT_TO_HALF_POINT(10),
  altSizePt: 8.5,
  altSizeHalfPt: PT_TO_HALF_POINT(8.5),

  gapBeforeIndexPt: 0,
  gapAfterIndexPt: 2,
  gapAfterTitlePt: 6,
  gapAfterImagePt: 10,
  gapBeforeStoryPt: 8,
  gapAfterStoryPt: 10,
  gapBeforeTechniquePt: 4,
  gapAfterTechniquePt: 8,
  gapBeforeTagsPt: 7,

  /* 0.5.4：打印向 —— 图片下方那行器材/参数 */
  techniqueInsetTwips: 720,
  /** 图注与图片的距离。0.5.5：4pt → 14pt（约 5mm）——参考摄影书，图注离图 5–8mm 才不粘在一起 */
  captionGapBeforePt: 14,
  captionGapAfterPt: 10,
  captionLineTwips: 240,
} as const;

export const WORD_FOOTER = {
  sizePt: 9,
  sizeHalfPt: PT_TO_HALF_POINT(9),
  color: '8A8A8A',
  lineTwips: 240,
  align: 'center',
} as const;

export const WORD_HEADER = {
  sizePt: 8.5,
  sizeHalfPt: PT_TO_HALF_POINT(8.5),
  color: '8A8A8A',
  borderSizeEighths: 4,
  borderColor: 'D8D4CC',
  align: 'right',
} as const;

export const FONT_SERIF = '宋体' as const;
export const FONT_LATIN = 'Times New Roman' as const;
export const FONT_FALLBACK_HINT = 'eastAsia' as const;

export interface WordFontSpec {
  eastAsia: string;
  latin: string;
  sizePt: number;
  sizeHalfPt: number;
  bold: boolean;
}

export const WORD_FONTS = {
  coverTitle: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 26,
    sizeHalfPt: PT_TO_HALF_POINT(26),
    bold: true,
  },
  coverSubtitle: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 12,
    sizeHalfPt: PT_TO_HALF_POINT(12),
    bold: false,
  },
  coverFooter: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 10.5,
    sizeHalfPt: PT_TO_HALF_POINT(10.5),
    bold: false,
  },
  overviewTitle: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 18,
    sizeHalfPt: PT_TO_HALF_POINT(18),
    bold: true,
  },
  overviewMeta: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 10,
    sizeHalfPt: PT_TO_HALF_POINT(10),
    bold: false,
  },
  caption: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 8.5,
    sizeHalfPt: PT_TO_HALF_POINT(8.5),
    bold: false,
  },
  sectionIndex: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 10,
    sizeHalfPt: PT_TO_HALF_POINT(10),
    bold: false,
  },
  sectionTitle: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 18,
    sizeHalfPt: PT_TO_HALF_POINT(18),
    bold: true,
  },
  storyBody: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 11.5,
    sizeHalfPt: PT_TO_HALF_POINT(11.5),
    bold: false,
  },
  techniqueLabel: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 10.5,
    sizeHalfPt: PT_TO_HALF_POINT(10.5),
    bold: true,
  },
  techniqueBody: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 10.5,
    sizeHalfPt: PT_TO_HALF_POINT(10.5),
    bold: false,
  },
  tags: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 10,
    sizeHalfPt: PT_TO_HALF_POINT(10),
    bold: false,
  },
  mood: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 10,
    sizeHalfPt: PT_TO_HALF_POINT(10),
    bold: false,
  },
  alt: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 8.5,
    sizeHalfPt: PT_TO_HALF_POINT(8.5),
    bold: false,
  },
  header: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 8.5,
    sizeHalfPt: PT_TO_HALF_POINT(8.5),
    bold: false,
  },
  footer: {
    eastAsia: FONT_SERIF,
    latin: FONT_LATIN,
    sizePt: 9,
    sizeHalfPt: PT_TO_HALF_POINT(9),
    bold: false,
  },
} as const satisfies Record<string, WordFontSpec>;

export const WORD_COLORS = {
  nearBlack: '#1A1A1A',
  midGray: '#6B6B6B',
  lightGray: '#8A8A8A',
  lineBeige: '#D8D4CC',
  paperWhite: '#FBFAF7',
} as const;

export function toDocxColor(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

export const WORD_LAYOUT_PRESETS = {
  compact: { frame: WORD_BODY.frameCompact, pageBreakPerPhoto: true },
  loose: { frame: WORD_BODY.frameLoose, pageBreakPerPhoto: true },
} as const;
