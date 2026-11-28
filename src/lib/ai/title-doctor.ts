/**
 * 标题体检与重写（0.8.2 补丁）。
 *
 * 为什么需要这一层：
 * 提示词已经写得很狠了（不许写成描述完整的句子、要像画册目录），但便宜模型照样交
 * 「刚拧干的抹布」「压着它的还是那块」这类句子 —— 用户的原话是「还是普通且人机」。
 * 光靠提示词治不住，所以这里加一道机械判定 + 机械重写：
 *
 *  1. 判「句子感」：带人称/指示代词的、带谓词又带「的」的、以「的/着/了/在/是」收尾的，一律算句子。
 *  2. 判「句式撞车」：一批照片里同一种句式（地名+时刻 / 单词 / 编号 / 并置）超过 3 张，就换一种。
 *  3. 重写只用赛事命名的四种构件，且只用照片自己正文里出现过的词：
 *     地名 + 时刻（「青石桥，清晨五点」）、单一实物词（「盐」）、无题编号（「无题 No.04」）、并置（「椅子与雨」）。
 *     ——不用正文里没有的词硬凑，凑不出来就退到编号，编号永远成立。
 *
 * 这一层的输出是确定性的：同一张照片、同一批已用标题，算出来的结果永远一样，单测能钉住。
 */
import type { TitleStyle } from '@/types/domain';

/** 一批照片里允许出现的同句式上限。超过就换句式，否则一眼看过去「全是一个模子」。 */
export const SHAPE_REPEAT_LIMIT = 3;

export type TitleShape = 'numbered' | 'place' | 'parallel' | 'single' | 'proper' | 'clause';

/** 地名构件：只收照片里真的会出现的那种地方词 */
const PLACE_WORDS = [
  '桥', '桥头', '街', '街上', '巷', '弄', '胡同', '码头', '港口', '车站', '站台', '渡口',
  '楼', '楼上', '楼下', '路', '大路', '路口', '厂', '厂房', '院子', '院里', '医院', '学校',
  '广场', '河边', '河岸', '江边', '海边', '岸上', '山坡', '村里', '镇上', '城里', '店里',
  '铺子', '馆子', '公园', '工地', '田里', '堤上', '隧道', '天桥', '阳台', '走廊', '楼梯',
  '窗口', '门口', '门口', '市场', '菜场', '宿舍', '教室', '车间', '屋顶', '天台',
];

/** 时刻构件：钟点、节气、天气节点 */
const TIME_WORDS = [
  '清晨', '早晨', '早上', '上午', '中午', '下午', '傍晚', '黄昏', '夜里', '深夜', '凌晨',
  '天亮', '日落', '入夜', '雨后', '雪后', '起风', '退潮', '涨潮', '初冬', '深秋', '冬天',
  '夏天', '春天', '秋天', '五月', '六月', '七月', '十一月', '十二月', '过年', '开学',
  '五点', '六点', '七点', '八点', '九点', '十点', '十一点', '十二点', '三点', '四点',
];

/** 实物词：能单独印在画册目录上还立得住的那些 */
const THING_WORDS = [
  '盐', '灯', '椅子', '凳子', '桌子', '床', '船', '雨', '铁皮', '绳', '麻绳', '招牌',
  '台阶', '墙', '窗', '门', '碗', '杯子', '水', '灰', '尘', '砖', '网', '布', '线',
  '桶', '盆', '伞', '帽子', '鞋', '手套', '闸', '秤', '梯子', '水泥', '玻璃', '铁门',
  '电表', '门牌', '天线', '树', '叶子', '猫', '狗', '鸟', '云', '雾', '雪', '风',
];

const CLAUSE_LEAD = /(它|他|她|我|你|这|那|其|还是|就是|只是|也是|都是|但是|因为|所以|不过|而且|如果|虽然)/;
const CLAUSE_VERB = /(在|是|有|把|被|着|了|过|都|还|也|又|才|就|正|刚|要|会|能|让|给)/;
/** 句子骨架：把字句、被字句、动词补语（洗得发白）—— 画册目录里不会出现这几种结构 */
const CLAUSE_FRAME = /[把被得]/;

/**
 * 在一段正文里挑一个构件词。挑**最长的那个**——「桥头」比「桥」具体，
 * 「清晨五点半」里的「清晨」比「早」具体；短词做标题太泛。
 */
const pick = (story: string, words: string[]): string | null => {
  let hit: string | null = null;
  for (const word of words) {
    if (!story.includes(word)) continue;
    if (!hit || word.length > hit.length) hit = word;
  }
  return hit;
};

/** 一段正文里，这件照片「在地的」构件：地名、时刻、实物（去重、按出现顺序） */
export function storyTokens(story: string | undefined): {
  place: string | null;
  time: string | null;
  things: string[];
} {
  const text = story ?? '';
  const things = THING_WORDS.filter((w) => text.includes(w));
  return { place: pick(text, PLACE_WORDS), time: pick(text, TIME_WORDS), things };
}

/**
 * 判句式。判成 clause 的，会在人工改写那一层被换掉。
 * 注意「老张的船」这种专名句不算 clause：它有「的」，但没有谓词。
 */
export function shapeOf(title: string): TitleShape {
  const t = title.trim();
  if (!t) return 'clause';
  if (/^(无题|未命名|习作|untitled)/i.test(t) || /No\.?\s*\d+/i.test(t)) return 'numbered';
  if (looksLikeClause(t)) return 'clause';

  const hasComma = /[，,、·—]/.test(t);
  const hasParallel = /[与和]/.test(t);
  if (hasParallel) return 'parallel';
  if (hasComma) {
    const { place, time } = storyTokens('');
    void place;
    void time;
    // 带逗号或破折号、两段都很短 → 地名+时刻 或 并置，两种都算「有结构的短标题」
    const parts = t.split(/[，,·—]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2 && parts.every((p) => p.length <= 6)) return 'place';
  }
  if (t.length <= 4 && !CLAUSE_VERB.test(t)) return 'single';
  return 'proper';
}

/** 句子感：这批标题里最刺眼的那种「散文半句」 */
export function looksLikeClause(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (CLAUSE_LEAD.test(t)) return true;
  if (CLAUSE_FRAME.test(t)) return true;
  if (CLAUSE_VERB.test(t) && t.includes('的')) return true;
  if (/[的着了在是和与把被还也都就才又很更最]$/.test(t)) return true;
  // 逗号后面接一长段（「北岸，雨把牌子洗得发白」）：地名 + 时刻 只允许两段都短
  const parts = t.split(/[，,]/).filter(Boolean);
  if (parts.length === 2 && parts[1]!.length > 6) return true;
  return false;
}

/**
 * 空的套话词。模型最爱拿它们拼标题，读起来「像标题」但其实什么都没说：
 * 「时光的痕迹」「光影之间」「岁月的温柔」。
 * 这些词本身不是错，单独做标题甚至能用（「城市」），但和 的/之间 拼起来就是套话。
 */
const ABSTRACT_WORDS =
  /(时光|岁月|光阴|光影|光与影|青春|记忆|往事|流年|生活|日常|城市|世界|人间|温柔|静好|诗意|瞬间|故事|痕迹|呼吸|呢喃|絮语|浅唱|远方|情绪|温度|角落|轮廓|余温|时间|孤独|寂静|静默|美好)/;

/**
 * 套话标题：抽象词 + 的/之间/里的，或者整条就是抽象的几段拼起来。
 * 判定很窄——「盐」「老张的船」「无题 No.04」都过不去，避免把好标题改坏。
 */
export function looksBland(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (!ABSTRACT_WORDS.test(t)) return false;
  if (/的|之间|之中|里的|时|里/.test(t)) return true;
  return t.length <= 4;
}

/** 给提示词用的句式名（「这批已经用过 地名+时刻 ×3」） */export const TITLE_SHAPE_LABELS: Record<TitleShape, string> = {
  numbered: '无题/编号',
  place: '地名+时刻',
  parallel: '并置',
  single: '单一实物词',
  proper: '专名',
  clause: '整句',
};

/** 统计一批标题里每种句式用了多少次 */
export function countTitleShapes(titles: string[]): Partial<Record<TitleShape, number>> {
  const counts: Partial<Record<TitleShape, number>> = {};
  for (const title of titles) {
    if (!title.trim()) continue;
    const shape = shapeOf(title);
    counts[shape] = (counts[shape] ?? 0) + 1;
  }
  return counts;
}

/** 构建器：每种都保证「短、不解释、可核对」；凑不出来返回 null */
const builders = {
  place(story: string): string | null {
    const { place, time } = storyTokens(story);
    if (place && time) return `${place}，${time}`;
    if (place) return place;
    if (time) return time;
    return null;
  },
  single(story: string): string | null {
    const { things } = storyTokens(story);
    return things[0] ?? null;
  },
  parallel(story: string): string | null {
    const { things } = storyTokens(story);
    if (things.length >= 2) return `${things[0]}与${things[1]}`;
    return null;
  },
  proper(story: string): string | null {
    const { things, place } = storyTokens(story);
    const person = /(老人|老头|老太太|孩子|小孩|师傅|老板娘|司机|女人|男人|男孩|女孩)/.exec(story);
    if (person && things[0]) return `${person[1]}的${things[0]}`;
    if (place && things[0]) return `${place}—${things[0]}`;
    return null;
  },
  numbered(index: number): string {
    return `无题 No.${String(Math.max(1, index)).padStart(2, '0')}`;
  },
};

/** 按命名法排出「优先换成的句式」；编号永远垫底（它一定成立） */
function rebuildOrder(style: TitleStyle | undefined): (keyof typeof builders)[] {
  switch (style) {
    case 'concise':
      return ['single', 'numbered'];
    case 'symbol':
      return ['numbered'];
    case 'plain':
      return ['place', 'numbered'];
    case 'cinematic':
      return ['proper', 'place', 'numbered'];
    case 'poetic':
      return ['parallel', 'place', 'numbered'];
    case 'literary':
      return ['place', 'numbered'];
    default:
      return ['place', 'single', 'numbered'];
  }
}

interface Range {
  min: number;
  max: number;
}

function inRange(text: string, range: Range): boolean {
  return text.length <= range.max;
}

/**
 * 把一条标题收拾成「画册目录里的一行字」。
 * 只在这几种情况下动手，其余原样放行（模型偶尔也能写对，不要一律重写）：
 *  - 有句子感（clause）
 *  - 超长（> max）
 *  - 同一种句式在已用标题里已经出现 3 次以上
 */
export function refineTitle(
  title: string,
  ctx: {
    story?: string;
    style?: TitleStyle;
    range: Range;
    /** 这张是本批第几张（1 起），编号兜底用 */
    index?: number;
    existingTitles?: string[];
  },
): { title: string; note: string | null } {
  const existing = ctx.existingTitles ?? [];
  const range = ctx.range;
  const shape = shapeOf(title);

  if (shape === 'clause') {
    const next = rebuild(title, ctx, pathOf(existing, [shape]));
    if (next) return { title: next, note: '标题写成了句子，换成「' + next + '」' };
  }

  // 空的套话（「时光的痕迹」）：换成像话的一行字，而不是换个套话继续
  if (looksBland(title)) {
    const next = rebuild(title, ctx, pathOf(existing, [shape]));
    if (next && next !== title) return { title: next, note: '标题是套话，换成「' + next + '」' };
  }

  if (title.length > range.max) {
    const cut = Math.max(
      title.lastIndexOf('，'),
      title.lastIndexOf('—'),
      title.lastIndexOf(' '),
      title.lastIndexOf('的'),
    );
    const candidate = cut >= 2 ? title.slice(0, cut).trim() : title.slice(0, range.max).trim();
    const next = candidate.length > range.max ? title.slice(0, range.max).trim() : candidate;
    if (next) return { title: next, note: '超过 ' + String(range.max) + ' 字，截短' };
  }

  if (existing.length >= SHAPE_REPEAT_LIMIT) {
    const sameShape = existing.filter((t) => shapeOf(t) === shape).length;
    if (sameShape >= SHAPE_REPEAT_LIMIT && shape !== 'numbered') {
      const next = rebuild(title, ctx, pathOf(existing, [shape]));
      if (next && next !== title) {
        return { title: next, note: '同一种句式已经用了 ' + String(sameShape) + ' 张，换一种' };
      }
    }
  }

  return { title, note: null };
}

/** 已用标题里每种句式的数量，重写时避开用得最多的 */
function pathOf(existingTitles: string[], avoid: TitleShape[]): Record<TitleShape, number> {
  const counts: Record<TitleShape, number> = {
    numbered: 0,
    place: 0,
    parallel: 0,
    single: 0,
    proper: 0,
    clause: 0,
  };
  for (const item of existingTitles) counts[shapeOf(item)] += 1;
  for (const shape of avoid) counts[shape] += SHAPE_REPEAT_LIMIT;
  return counts;
}

function rebuild(
  title: string,
  ctx: { story?: string; style?: TitleStyle; range: Range; index?: number },
  shapeCounts: Record<TitleShape, number>,
): string | null {
  const story = ctx.story ?? '';
  const order = rebuildOrder(ctx.style);
  // 句式用得越少越优先：地名+时刻用多了就先试单词，反之亦然
  order.sort((a, b) => (shapeCounts[a as TitleShape] ?? 0) - (shapeCounts[b as TitleShape] ?? 0));

  for (const key of order) {
    const built =
      key === 'numbered'
        ? builders.numbered(ctx.index ?? 1)
        : (builders[key] as (s: string) => string | null)(story);
    if (!built) continue;
    if (built === title) continue;
    if (!inRange(built, ctx.range)) continue;
    return built;
  }
  return null;
}
