// src/lib/export/blocks.ts
// 0.5.7：把「一张照片那一页」拆成可拼装的板块（积木）。
//
// 之前每个开关都是写死在 body.ts 的固定顺序里（序号 → 标题 → 图 → 图注 → 正文 →
// 参数表 → 评分卡 → 三块建议 → 拍摄手法 → 标签 → 氛围 → 无障碍），用户只能决定
// 「印不印」，不能决定「放在哪、谁在上面」。这一版把这些都变成板块：
// 用户可以自由开关、拖拽排序，也能整体套用一个模板。
//
// 两条硬规矩（本文件负责在排版前就算清楚，body.ts 只是照着排）：
//   1. 一页里永远是一张照片 + 它自己的文字，照片和文字不许被分到两页（见 planPhotoPage）；
//   2. 板块再多，图片也要能缩到 minimumImageCm 保住整页不溢出，溢出了就要提示用户。

import type { ExportSettings, Photo } from '@/types/domain';

/** 照片页里可以拼装的板块 */
export type PhotoBlockId =
  | 'index'
  | 'title'
  | 'image'
  | 'caption'
  | 'story'
  | 'exif'
  | 'params'
  | 'score'
  | 'advice'
  | 'technique'
  | 'category'
  | 'tags'
  | 'mood'
  | 'alt';

export interface BlockMeta {
  id: PhotoBlockId;
  label: string;
  /** 一句话说明，UI 上直接显示 */
  hint: string;
  group: '版面' | '文字' | '解读';
  /** 大致占高（cm），用于排版预算；image 由剩余空间决定，这里为 0 */
  heightCm: number;
}

/**
 * 板块清单。顺序即 UI 里的推荐顺序，也是模板拼装时的参考顺序。
 * heightCm 是「一行到两行文字」的实测经验值（10.5pt、1.6 行距、A4 版心 16.6cm）。
 */
export const BLOCKS: BlockMeta[] = [
  { id: 'index', label: '照片序号', hint: '左上角的 01、02，画册里常用', group: '版面', heightCm: 0.95 },
  { id: 'title', label: '标题', hint: '这张照片的名字，18pt 加粗', group: '版面', heightCm: 1.0 },
  { id: 'image', label: '照片', hint: '主图，会按剩余空间自动缩放', group: '版面', heightCm: 0 },
  { id: 'caption', label: '图注', hint: '图下小字，摄影书口径「图 01 · 标题」', group: '版面', heightCm: 0.62 },
  {
    id: 'story',
    label: '正文 / 点评',
    hint: 'AI 写的那段故事，参赛自述也用它',
    group: '文字',
    heightCm: 3.2,
  },
  { id: 'technique', label: '拍摄手法', hint: '构图 / 光线 / 色彩 / 镜头 / 后期五行', group: '文字', heightCm: 4.2 },
  { id: 'category', label: '图片类别', hint: '题材归类（夜景、街头、人像…）', group: '解读', heightCm: 0.62 },
  { id: 'tags', label: '标签', hint: 'AI 抽的关键词，印成 #标签', group: '文字', heightCm: 1.15 },
  { id: 'mood', label: '氛围', hint: '一句话的调性描述', group: '文字', heightCm: 0.62 },
  { id: 'alt', label: '无障碍描述', hint: '给读屏用的一句话，印出来最浅', group: '文字', heightCm: 0.62 },
  { id: 'exif', label: '相机信息', hint: '机身 / 镜头 / 拍摄时间', group: '解读', heightCm: 1.1 },
  { id: 'params', label: '拍摄参数', hint: '焦段 / 光圈 / 快门 / ISO / 调色', group: '解读', heightCm: 1.55 },
  { id: 'score', label: '评分卡', hint: '总分 + 六项打分，评委口径', group: '解读', heightCm: 1.95 },
  {
    id: 'advice',
    label: '点评与改进建议',
    hint: '为什么好 / 可以更好 / 下次这样拍',
    group: '解读',
    heightCm: 2.1,
  },
];

export const BLOCK_MAP: Record<PhotoBlockId, BlockMeta> = BLOCKS.reduce(
  (acc, block) => {
    acc[block.id] = block;
    return acc;
  },
  {} as Record<PhotoBlockId, BlockMeta>,
);

export function isBlockId(value: unknown): value is PhotoBlockId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_MAP, value);
}

/**
 * 默认板块（= 0.5.6 的默认版式，升级后打开旧项目看起来一模一样）：
 * 序号、标题、图、图注、正文、拍摄手法、标签。
 */
export const DEFAULT_BLOCKS: PhotoBlockId[] = [
  'index',
  'title',
  'image',
  'caption',
  'story',
  'technique',
  'tags',
];

export interface ExportTemplate {
  id: string;
  name: string;
  hint: string;
  blocks: PhotoBlockId[];
  /** 套用模板时连带改掉的其它设置（只写必要项，其余保持用户当前选择） */
  patch?: Partial<ExportSettings>;
}

/** 固定模板：选完直接能导出，不用自己拼 */
export const TEMPLATES: ExportTemplate[] = [
  {
    id: 'photobook',
    name: '摄影集',
    hint: '一页一张大图，只有标题与图注 —— 最像正式画册',
    blocks: ['index', 'title', 'image', 'caption', 'story'],
    patch: { includeScoreDetail: false, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'contest',
    name: '参赛投稿',
    hint: '图 + 自述 + 类别 + 评分 + 改进建议，适合投比赛用',
    blocks: ['index', 'title', 'image', 'caption', 'story', 'category', 'score', 'advice'],
    patch: { includeScoreDetail: true, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'tech',
    name: '技术档案',
    hint: '把自己当作品集给同行看：参数、手法、评分都印上',
    blocks: ['index', 'title', 'image', 'caption', 'exif', 'params', 'technique', 'score'],
    patch: { includeScoreDetail: true, captionStyle: 'both', pageBreakPerPhoto: true },
  },
  {
    id: 'minimal',
    name: '极简画册',
    hint: '一张图配一行图注，留白最多，打印最省钱',
    blocks: ['image', 'caption'],
    patch: { includeScoreDetail: false, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'journal',
    name: '图文随笔',
    hint: '标题、图、正文、标签、氛围 —— 像一本旅行日记',
    blocks: ['title', 'image', 'caption', 'story', 'tags', 'mood'],
    patch: { includeScoreDetail: false, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'full',
    name: '完整档案',
    hint: '所有板块都印上，信息最全（图片会被压小）',
    blocks: BLOCKS.map((block) => block.id),
    patch: { includeScoreDetail: true, captionStyle: 'both', pageBreakPerPhoto: true },
  },
];

export function getTemplate(id: string | undefined): ExportTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/** 旧设置（没有 blocks 字段）→ 等价板块顺序，保证老项目打开后版式不变 */
function legacyBlocks(settings: ExportSettings): PhotoBlockId[] {
  const order: PhotoBlockId[] = [];
  if (settings.showIndex) order.push('index');
  order.push('title', 'image');
  if (settings.captionUnderImage !== false) order.push('caption');
  if (settings.includeStory) order.push('story');
  // 参数表 / 评分卡 / 三块建议以前是一整块「解读」开关
  if (settings.includeTechnique && settings.includeScoreDetail) order.push('params', 'score', 'advice');
  if (settings.includeTechnique) order.push('technique');
  if (settings.includeTags) order.push('tags');
  if (settings.includeMood) order.push('mood');
  if (settings.includeAlt) order.push('alt');
  return order;
}

/**
 * 取这一页实际要排的板块（已去重、已按用户顺序）。
 * 空数组/非法值都退回默认值，避免用户手改配置文件把导出搞崩。
 */
export function resolveBlocks(settings: ExportSettings): PhotoBlockId[] {
  const explicit = settings.blocks;
  if (Array.isArray(explicit) && explicit.length > 0) {
    const seen = new Set<PhotoBlockId>();
    const ordered: PhotoBlockId[] = [];
    for (const raw of explicit) {
      if (!isBlockId(raw) || seen.has(raw)) continue;
      seen.add(raw);
      ordered.push(raw);
    }
    if (ordered.length > 0) return ordered;
  }
  return legacyBlocks(settings);
}

/** 把用户拖出来的顺序写回设置（顺带维护旧的布尔开关，PPT/翻页预览还看它们） */
export function applyBlocks(settings: ExportSettings, blocks: PhotoBlockId[]): ExportSettings {
  const set = new Set(blocks);
  return {
    ...settings,
    blocks: [...blocks],
    // 旧字段保持同步：PPT 导出与预览还在读这些布尔值
    includeStory: set.has('story'),
    includeTechnique: set.has('technique'),
    includeTags: set.has('tags'),
    includeMood: set.has('mood'),
    includeAlt: set.has('alt'),
    includeScoreDetail: set.has('score') || set.has('advice'),
    captionUnderImage: set.has('caption'),
  };
}

/**
 * 一页的高度预算。Image 之外的所有板块高度都按内容估一个上界，
 * 剩下的才是图片的可用高度，最后再减 3.6cm 的段间距/页脚余量。
 */
export interface PageFitInput {
  photo: Photo;
  settings: ExportSettings;
  contentCm: number;
  contentHeightCm: number;
  /** 单张章节时这页顶端还压着章头 */
  hasChapterHeading?: boolean;
}

export interface PageFit {
  /** 实际要排的板块 */
  blocks: PhotoBlockId[];
  /** 除图片外的文字高度（cm） */
  textCm: number;
  /** 图片最多能占的高度（cm），已扣掉最小可用高度 */
  imageRoomCm: number;
  /** 这一页预计占用的比例（0–1+），>1 说明装不下，要提示用户 */
  fillRatio: number;
  /** 装不下时超出多少 cm */
  overflowCm: number;
  /** 最紧的时候图片会缩到这个高度 */
  minimumImageCm: number;
  /** 这页上实际会被印出来的板块（装不下时从低优先级开始让位） */
  dropped: PhotoBlockId[];
}

/** 图片最小高度：再小就不像一张照片了，宁可从低优先级板块开始让位 */
const MINIMUM_IMAGE_CM = 6.6;
/** 段间距 + 页脚余量（0.5.4 起就是 3.6cm，实测再小一行就会掉页） */
const PAGE_SLACK_CM = 3.6;
/** 紧凑章头（章号 + 章名 + 分隔线）实测高度 */
const CHAPTER_HEADING_CM = 2.9;

/** 一个板块在这张照片上大概占多高（cm） */
export function blockHeightCm(id: PhotoBlockId, input: PageFitInput): number {
  const { photo, contentCm } = input;
  const analysis = photo.status === 'success' ? photo.analysis : undefined;

  switch (id) {
    case 'image':
      return 0; // 由剩余空间决定
    case 'index':
      return 0.95;
    case 'title':
      return 1.0;
    case 'caption':
      return 0.62;
    case 'category':
      return 0.62;
    case 'mood':
      return 0.62;
    case 'alt':
      return 0.62;
    case 'tags': {
      // 5 个 #标签 常常折成两行
      const count = analysis?.tags?.length ?? 0;
      return count > 0 ? 1.15 : 0;
    }
    case 'exif': {
      if (!photo.exif) return 0;
      return 1.1;
    }
    case 'story': {
      const text = analysis?.story?.trim() ?? '';
      if (!text) return 0;
      const perLine = Math.max(18, Math.round(contentCm / 0.38));
      const lines = Math.ceil(text.length / perLine);
      return lines * 0.6 + 0.5;
    }
    case 'technique': {
      if (!analysis) return 0;
      const lines = Object.values(analysis.technique).filter((value) => value.trim().length > 0).length;
      return lines > 0 ? lines * 0.6 + 0.95 : 0;
    }
    case 'params': {
      if (!analysis?.params) return 0;
      return 1.55;
    }
    case 'score': {
      if (!analysis?.score) return 0;
      return 1.95;
    }
    case 'advice': {
      if (!analysis) return 0;
      const maxColumn = Math.max(
        analysis.whyGood?.length ?? 0,
        analysis.improve?.length ?? 0,
        analysis.imitate?.length ?? 0,
      );
      return maxColumn > 0 ? maxColumn * 0.55 + 1.15 : 0;
    }
    default:
      return 0;
  }
}

/**
 * 算这一页怎么排。核心目的只有一个：**照片和它的文字永远在同一页**。
 * 做法是把「文字高度」先全部算出来，图片只能吃剩下的空间；
 * 如果连最小图片都放不下，就按优先级依次丢掉可让位的板块（无障碍 → 氛围 →
 * 标签 → 相机信息 → 图片类别 → 评分卡 → 点评），并把它记在 dropped 里，
 * 让导出结束时能如实告诉用户「有几项没印下去」。
 */
export function planPhotoPage(input: PageFitInput): PageFit {
  const blocks = resolveBlocks(input.settings);
  const headingCm = input.hasChapterHeading ? CHAPTER_HEADING_CM : 0;
  const budget = input.contentHeightCm - headingCm - PAGE_SLACK_CM;

  // 让位顺序：越靠前越先被丢（信息密度低、删掉不心疼）
  const YIELD_ORDER: PhotoBlockId[] = ['alt', 'mood', 'tags', 'exif', 'category', 'score', 'advice', 'story'];

  const heights = new Map<PhotoBlockId, number>();
  for (const id of blocks) {
    if (id === 'image') continue;
    heights.set(id, blockHeightCm(id, input));
  }

  const sumText = () => [...heights.values()].reduce((total, value) => total + value, 0);

  const dropped: PhotoBlockId[] = [];
  let textCm = sumText();

  // 先把图片压到最小；还装不下才开始丢板块
  while (textCm + MINIMUM_IMAGE_CM > budget && YIELD_ORDER.length > 0) {
    const victim = YIELD_ORDER.find(
      (id) => !dropped.includes(id) && blocks.includes(id) && (heights.get(id) ?? 0) > 0,
    );
    if (!victim) break;
    dropped.push(victim);
    heights.set(victim, 0);
    textCm = sumText();
  }

  const imageRoomCm = Math.max(MINIMUM_IMAGE_CM, budget - textCm);
  const overflowCm = Math.max(0, textCm + MINIMUM_IMAGE_CM - budget);
  const fillRatio = (textCm + imageRoomCm) / Math.max(1, budget);

  return {
    blocks,
    textCm,
    imageRoomCm,
    fillRatio,
    overflowCm,
    minimumImageCm: MINIMUM_IMAGE_CM,
    dropped,
  };
}

/** 板块的短标签，导出结束提示里用 */
export function blockLabel(id: PhotoBlockId): string {
  return BLOCK_MAP[id]?.label ?? id;
}

/**
 * 把「这一页最终会印成什么样」翻译成一句给模型看的话。
 * 0.5.7：文案要跟着版面走 —— 极简画册的那一页只放图加一行字，
 * 硬塞 200 字正文印出来就是灾难。这句话会拼进分析用提示词。
 */
export function pageHint(settings: ExportSettings): string {
  const ids = resolveBlocks(settings);
  const set = new Set(ids);
  const parts: string[] = [];

  if (!set.has('title')) {
    parts.push('这一页不印标题，所以标题只作内部标记，请写最短、最能指认的一张，4–8 字');
  } else {
    parts.push('这一页会印标题（4–10 字，必须能指认出画面里的具体东西）');
  }

  if (!set.has('story')) {
    parts.push('这一页不印正文，story 只写 1 句话（30–50 字），把最值得说的那件事说完就停');
  } else if (set.has('score') || set.has('advice') || set.has('params')) {
    parts.push('这一页除了正文还印参数/评分/建议，story 控制在 90–130 字，别把版面挤满');
  } else if (ids.length <= 6) {
    parts.push('这一页留给照片的空间大，story 写 120–180 字，允许铺开写');
  } else {
    parts.push('这一页板块较多，story 控制在 90–140 字');
  }

  if (set.has('caption') && (settings.captionStyle ?? 'title') !== 'both') {
    parts.push('图注只会印编号加标题，画面里的关键信息请写进 story，不要指望图注补充');
  }
  if (set.has('category')) parts.push('会单独印「类别」一行，请让 tags 的第一个是最准确的题材词');
  if (!set.has('technique')) parts.push('这一页不印拍摄手法，构图/光线/调色不必在 story 里复述');
  if (set.has('alt')) parts.push('会印无障碍描述，story 请避免与 alt 内容重复');

  return parts.join('；');
}