// src/lib/export/typography.ts
// 0.6.4：整本书的排版系统（字号层级、行距、间距、颜色、照片处理、版式预设）。
//
// 为什么要有这个文件：
// 0.6.3 之前，字号/间距/颜色散落在 pdf.ts 的 CSS、word-grid.ts 的 run 属性、
// flat-blocks.ts 的字面值里，同一页的图注在 PDF 是 8.5pt 灰、在 Word 是 9pt 深灰，
// 「参考摄影书做版式」根本无从谈起。现在只有这一份定义，两边都从这里取值。
//
// 数值依据真实摄影画册与中文书籍排版惯例（见 docs/更新日志_0.6.4.md）：
// - 正文 10.5pt（五号）/ 固定行距 17.85pt（基线 6.3mm，252mm 版心正好 40 行）
// - 图注 8.5pt 无衬线、参数 7.5pt 加字距、页码 8pt
// - 正文墨色 #1a1a1a（不用纯黑）、图注 #6b6b6b（对比度 5.33:1，过 WCAG AA）
// - 照片直角、留白衬底按需开启、投影一律不用

export type PageStyleId = 'album' | 'essay' | 'archive';

export type TypeColor = 'ink' | 'soft' | 'line' | 'accent';

export interface TypeSpec {
  /** 字号（磅） */
  sizePt: number;
  /** 行距（磅，固定值 —— 倍数行距会让每页行数随字体漂移） */
  linePt: number;
  /** 字距（em） */
  tracking: number;
  /** serif=叙述层（宋/楷/仿宋），sans=信息层（黑体/苹方） */
  family: 'serif' | 'sans';
  color: TypeColor;
  /** docx 里的粗细（400 常规 / 600 半粗） */
  weight: number;
}

const spec = (
  sizePt: number,
  linePt: number,
  family: TypeSpec['family'],
  color: TypeColor = 'ink',
  tracking = 0,
  weight = 400,
): TypeSpec => ({ sizePt, linePt, tracking, family, color, weight });

export interface PhotoTreatment {
  /** 照片最大高度占版心高度的比例 */
  maxHeightRatio: number;
  /** 留白衬底（passe-partout）白边宽度 mm，0 = 不开 */
  matteMm: number;
  /** 圆角 mm，画册惯例是 0 */
  radiusMm: number;
  /** 细边框（磅），0 = 不加 */
  borderPt: number;
  /** 投影：摄影画册一律不用 */
  shadow: boolean;
  /** 照片水平位置 */
  align: 'left' | 'center';
}

export interface PageStyle {
  id: PageStyleId;
  label: string;
  hint: string;
  /** 页面四边距（cm，四边一致；Word 不做镜像边距，这里统一） */
  marginCm: number;
  /** 每页正文可用高度（cm，A4 竖版） */
  flowHeightCm: number;
  body: TypeSpec;
  /** 正文首行缩进（2 字符） */
  bodyIndent: boolean;
  /** 两端对齐 */
  bodyJustify: boolean;
  pageTitle: TypeSpec;
  chapterNo: TypeSpec;
  chapterTitle: TypeSpec;
  chapterNote: TypeSpec;
  captionNum: TypeSpec;
  caption: TypeSpec;
  specText: TypeSpec;
  folio: TypeSpec;
  photo: PhotoTreatment;
  numbering: 'zero' | 'fig';
  showFolio: boolean;
  /** 强调色（文艺随笔用低饱和赭，极简画册不用） */
  accent: string | null;
}

const SANS = 'sans' as const;
const SERIF = 'serif' as const;

/** 三套版式预设：极简画册 / 文艺随笔 / 技术档案 */
export const PAGE_STYLES: PageStyle[] = [
  {
    id: 'album',
    label: '极简画册',
    hint: '大图 + 小字，像作者画册。图片居中，参数弱化',
    marginCm: 2.0,
    flowHeightCm: 25.7,
    body: spec(10.5, 17.85, SERIF),
    bodyIndent: true,
    bodyJustify: true,
    pageTitle: spec(15, 22, SANS, 'ink', 0.02, 600),
    chapterNo: spec(9, 11, SANS, 'soft', 0.16),
    chapterTitle: spec(24, 32, SERIF, 'ink', 0.04),
    chapterNote: spec(9.5, 15, SANS, 'soft', 0.01),
    captionNum: spec(8, 11.2, SANS, 'soft', 0.08),
    caption: spec(8.5, 11.9, SANS, 'soft', 0.01),
    specText: spec(7.5, 11.25, SANS, 'soft', 0.05),
    folio: spec(8, 9.6, SANS, 'soft', 0.05),
    photo: { maxHeightRatio: 0.7, matteMm: 0, radiusMm: 0, borderPt: 0, shadow: false, align: 'center' },
    numbering: 'zero',
    showFolio: true,
    accent: null,
  },
  {
    id: 'essay',
    label: '文艺随笔',
    hint: '图小一点、字多一点，留白衬底 + 一点赭色。适合文字为主的册子',
    marginCm: 2.1,
    flowHeightCm: 25.5,
    body: spec(11, 19.25, SERIF),
    bodyIndent: true,
    bodyJustify: true,
    pageTitle: spec(16, 24, SERIF, 'ink', 0.02, 400),
    chapterNo: spec(9, 11, SANS, 'soft', 0.16),
    chapterTitle: spec(26, 34, SERIF, 'ink', 0.04),
    chapterNote: spec(10, 16, SERIF, 'soft', 0.01),
    captionNum: spec(8, 11.2, SANS, 'accent', 0.08),
    caption: spec(8.5, 12.2, SANS, 'soft', 0.01),
    specText: spec(7.5, 11.25, SANS, 'soft', 0.05),
    folio: spec(8, 9.6, SANS, 'soft', 0.05),
    photo: { maxHeightRatio: 0.5, matteMm: 6, radiusMm: 0, borderPt: 0, shadow: false, align: 'left' },
    numbering: 'zero',
    showFolio: true,
    accent: '#8a5a3b',
  },
  {
    id: 'archive',
    label: '技术档案',
    hint: '参数与手法排双列小字，图带细边。适合给同行看的作品集',
    marginCm: 1.9,
    flowHeightCm: 25.9,
    body: spec(10, 16.5, SERIF),
    bodyIndent: true,
    bodyJustify: true,
    pageTitle: spec(14, 20, SANS, 'ink', 0.02, 600),
    chapterNo: spec(9, 11, SANS, 'soft', 0.16),
    chapterTitle: spec(22, 30, SANS, 'ink', 0.04, 600),
    chapterNote: spec(9, 14.5, SANS, 'soft', 0.01),
    captionNum: spec(8, 11.2, SANS, 'soft', 0.1),
    caption: spec(8, 11.5, SANS, 'soft', 0.01),
    specText: spec(7.5, 11.25, SANS, 'soft', 0.05),
    folio: spec(8, 9.6, SANS, 'soft', 0.05),
    photo: { maxHeightRatio: 0.46, matteMm: 0, radiusMm: 0, borderPt: 0.35, shadow: false, align: 'left' },
    numbering: 'fig',
    showFolio: true,
    accent: null,
  },
];

export function pageStyle(id: PageStyleId | undefined): PageStyle {
  return PAGE_STYLES.find((s) => s.id === id) ?? PAGE_STYLES[0];
}

/** 磅 → 毫米 */
export const PT_TO_MM = 25.4 / 72;
/** 毫米 → 磅 */
export const MM_TO_PT = 72 / 25.4;
/** 毫米 → twips（docx 内部单位） */
export const mmToTwips = (mm: number): number => Math.round(mm * 56.6929);
/** 磅 → twips */
export const ptToTwips = (pt: number): number => Math.round(pt * 20);

/**
 * 编号：画册用「01」，技术档案用「FIG. 01」。
 * 图注里编号与说明之间用 1/4 空格（不是冒号、不是点）—— 这是画册的通行做法。
 */
export function figureNumber(index: number, style: PageStyle): string {
  const n = String(index).padStart(2, '0');
  return style.numbering === 'fig' ? `FIG. ${n}` : n;
}

/** 章节号：第 01 章 */
export function chapterNumber(no: number): string {
  return `第 ${String(no).padStart(2, '0')} 章`;
}

/**
 * 把一段中文正文按中文标点避头尾规则整理：
 * 行首不留 ，。、；：！？」』）】 之类的收尾标点（由 CSS line-break: strict 处理，
 * 这里只做「连续空白合并 + 去句尾多余空格」这类模型常犯的小毛病）。
 */
export function tidyReading(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([，。；：！？、])/g, '$1')
    .replace(/([「『（【])\s+/g, '$1')
    .trim();
}

/** 页脚页码：只印阿拉伯数字，两侧用小号间隔号修饰，像画册的 folio */
export function folioLabel(pageNo: number): string {
  return String(pageNo);
}

/** 给 CSS 用：字号/字距/行高（mm） */
export function cssType(t: TypeSpec, familyCss: { serif: string; sans: string }): string {
  const family = t.family === 'sans' ? familyCss.sans : familyCss.serif;
  const parts = [
    `font-family:${family}`,
    `font-size:${t.sizePt}pt`,
    `line-height:${(t.linePt * PT_TO_MM).toFixed(2)}mm`,
    `letter-spacing:${t.tracking}em`,
    `font-weight:${t.weight}`,
  ];
  return parts.join(';');
}

/** 用于估算高度时把行距换算成厘米 */
export function lineHeightCm(t: TypeSpec): number {
  return t.linePt * PT_TO_MM * 0.1;
}
