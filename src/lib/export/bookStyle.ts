import type { ExportSettings } from '@/types/domain';

/**
 * 0.6.3 新增：整本书的「字体 / 纸色 / 前言」都归这里管。
 *
 * 为什么单独一个文件：
 * PDF 侧是 HTML + CSS，Word 侧是 docx 的 run 字体，两边必须用**同一份**定义，
 * 否则就会出现「屏幕上是宋体、纸上变成别的字体」这种经典错位。
 */

export type BookBodyFont = 'song' | 'hei' | 'kai' | 'fang';

interface BodyFontOption {
  id: BookBodyFont;
  label: string;
  hint: string;
  /** PDF / HTML 用的字体族栈（本机有什么就用什么，最后都有兜底） */
  css: string;
  /** Word 里写的字体名，必须是 Windows 自带的名字 */
  word: string;
}

export const BODY_FONT_OPTIONS: BodyFontOption[] = [
  {
    id: 'song',
    label: '宋体',
    hint: '默认。印刷体最耐读，适合大段正文',
    css: '"Songti SC", "SimSun", "宋体", serif',
    word: '宋体',
  },
  {
    id: 'kai',
    label: '楷体',
    hint: '像手写，适合散文、图注',
    css: '"Kaiti SC", "KaiTi", "楷体", "STKaiti", serif',
    word: '楷体',
  },
  {
    id: 'fang',
    label: '仿宋',
    hint: '公文与画册说明常用，笔画清瘦',
    css: '"FangSong", "仿宋", "STFangsong", serif',
    word: '仿宋',
  },
  {
    id: 'hei',
    label: '黑体',
    hint: '现代感强，适合小字距的短句',
    css: '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif',
    word: '微软雅黑',
  },
];

export function bodyFontOption(id: BookBodyFont | undefined): BodyFontOption {
  return BODY_FONT_OPTIONS.find((f) => f.id === id) ?? BODY_FONT_OPTIONS[0];
}

/** 标题一律走无衬线（黑体），和宋体正文形成层级对比 —— 这是画册最稳的一招 */
export const HEAD_FONT_CSS = '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif';
export const HEAD_FONT_WORD = '微软雅黑';

export type PaperTintId = 'white' | 'ivory' | 'gray' | 'night';

interface PaperTintOption {
  id: PaperTintId;
  label: string;
  hint: string;
  /** 纸面底色 */
  bg: string;
  /** 主要墨色 */
  ink: string;
  /** 次要墨色（图注、说明） */
  inkSoft: string;
  /** 细分隔线 */
  line: string;
}

export const PAPER_TINY_OPTIONS: PaperTintOption[] = [
  {
    id: 'white',
    label: '纯白',
    hint: '打印最干净，墨最省',
    bg: '#ffffff',
    ink: '#16161a',
    inkSoft: '#5c5c66',
    line: '#d8d8de',
  },
  {
    id: 'ivory',
    label: '米白',
    hint: '像画册内页的胶版纸，眼睛舒服',
    bg: '#fbf8f1',
    ink: '#26221c',
    inkSoft: '#6b6357',
    line: '#ddd6c7',
  },
  {
    id: 'gray',
    label: '浅灰',
    hint: '极简风格，适合彩色大图',
    bg: '#f6f6f7',
    ink: '#1b1b1f',
    inkSoft: '#61616b',
    line: '#d5d5dc',
  },
  {
    id: 'night',
    label: '墨黑',
    hint: '屏幕上像作品集，不建议整本打印',
    bg: '#1b1b1f',
    ink: '#f2f2f4',
    inkSoft: '#a8a8b2',
    line: '#3a3a44',
  },
];

export function paperTintOption(id: PaperTintId | undefined): PaperTintOption {
  return PAPER_TINY_OPTIONS.find((p) => p.id === id) ?? PAPER_TINY_OPTIONS[0];
}

/**
 * 把导出设置「收口」成一个自洽的版本。
 *
 * 现在只做一件事，但它很关键：**当相框已经把机型/参数烧进图片里时，
 * 不再重复印一遍相机信息与参数表**。之前用户的页面上同时出现
 * 「图片里烧着的 SONY ILCE-7RM2 · 1/1600 · f/4」和 docx 里那行
 * 「SONY ILCE-7RM2 · 1/1600 · f/4 · ISO 100」，看着像排错了。
 */
export function normalizeExportSettings(settings: ExportSettings): ExportSettings {
  const frame = settings.frame ?? 'none';
  const burnsParams = frame === 'leica' || frame === 'film' || settings.watermark === true;
  if (!burnsParams) return settings;

  const drop: string[] = ['exif', 'params'];
  const next: ExportSettings = {
    ...settings,
    // 图注也别再印参数，否则同一页会出现三处曝光值
    captionStyle: (settings.captionStyle ?? 'title') === 'both' ? 'title' : settings.captionStyle,
  };
  if (Array.isArray(settings.blocks)) {
    const kept = settings.blocks.filter((id) => !drop.includes(id));
    next.blocks = kept.length > 0 ? (kept as ExportSettings['blocks']) : settings.blocks;
  }
  if (settings.grid && Array.isArray(settings.grid.items)) {
    const items = settings.grid.items.filter((it) => !drop.includes(it.id));
    if (items.length > 0) next.grid = { ...settings.grid, items };
  }
  return next;
}
