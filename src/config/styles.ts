// src/config/styles.ts
// AI 文案风格目录：标题命名法 / 叙事风格 / 字数档位。
// 改这里的 hint 就会改变生成结果，不需要动 prompts.ts 的主结构。
//
// 0.7.5：hint 从「一句话形容词」改成「写法的具体动作 + 两个例子」。
// 之前写「有画面感的物象标题」，模型只能理解成「加形容词」；
// 写成「从画面角落挑一件不起眼的东西，只写它和它周围」，它才会真的去指物。
//
// 0.8.1（本次）：六种写法整体换成**国际摄影赛事/画册里真实存在的命名法**。
// 上一版六种（文学意象 / 四字凝练 / 诗性对仗 / 电影片名 / 朴素纪实 / 隐喻象征）
// 不管选哪种，模型交出来的都是同一种东西——4–10 字的描述性短句
// （「光只到了半条街」「刚拧干的抹布」）。单看一句还行，一批照片排在一起
// 就像同一个模子倒出来的，正是用户说的「人机、好普通」。
//
// 参考的命名法（都来自公开的赛事获奖名录与画册目录）：
// · 单词：Sony 2024 获奖作 "Moonrise Sprites over Storr" 之外，大量入围作只有一个词
//   （"Love" 获 IPA，中文赛事同样常见《视界》《盐》）。
// · 无题 / 编号："Untitled No.7"、"Study 12"、系列里的「之三」，把解释权交出去。
// · 地名与时刻："Havana, 1998"、中文的「北岸，十一月」——地点加时间刻度，不带形容。
// · 专名："Spiralkampagnen"（丹麦强制节育案的档案名）、「香豌豆—友谊」，一个名字不加解释。
// · 引语："Mala tempora currunt"（IPA 获奖作，拉丁谚语），中文里借半句诗或招牌上的字。
// · 并置：「亮着的店，关着的门」——两样东西并排，关系不点破。
// 这六种都是「短、不解释、可核对」，而且彼此的语感差得很远，一批照片混排也不会像一个模子。

import type { NarrativeStyle, StoryLength, TitleStyle } from '@/types/domain';

export interface StyleOption<T extends string> {
  id: T;
  label: string;
  /** 写进提示词的具体要求 */
  hint: string;
  /** UI 上的一句话说明 */
  note: string;
}

/**
 * 从 hint 末尾的「例：「盐」「守夜人」」里取出示例，给界面直接用。
 * 不单独存一份 examples 数组：提示词和界面共用一个来源，改了 hint 就不会两边不同步。
 */
export function styleExamples(style: StyleOption<string>): string[] {
  const tail = /例：(.+)$/s.exec(style.hint);
  if (!tail?.[1]) return [];
  return [...tail[1].matchAll(/「([^」]+)」/g)].map((m) => m[1]!);
}

export const TITLE_STYLES: StyleOption<TitleStyle>[] = [
  {
    id: 'concise',
    label: '单词',
    hint: '只交一个词：一个实体、一个身份，或一个单字。不加修饰、不用「的」把两样东西连起来、不写动词短语。'
      + '要能单独印在画册目录里还立得住。例：「盐」「守夜人」「退潮」',
    note: '一个词，像画册目录',
  },
  {
    id: 'symbol',
    label: '无题 / 编号',
    hint: '把判断权交给看的人：写「无题」「无题 No.07」「习作 12」「某地·三」。编号用阿拉伯数字，'
      + '可以带「No.」与空格；除编号外不许再加解释。例：「无题 No.04」「码头习作 12」',
    note: '不给解释，只给编号',
  },
  {
    id: 'plain',
    label: '地名与时刻',
    hint: '一处地名 + 一个时间刻度，中间用逗号或空格，不加任何形容词。地名可以只是泛称（国道、码头、七楼），'
      + '时间刻度用年月、钟点、节气或天气节点。例：「青石桥，清晨五点」「北岸，十一月」「七楼，雨后」',
    note: '地点加时间，像档案记录',
  },
  {
    id: 'cinematic',
    label: '专名',
    hint: '像展览名或作品系列：一个专名（人名、地名、方言词、店铺旧称），或「系列—副题」。'
      + '专名不必解释，读的人自己去查；允许一个破折号。例：「香豌豆—友谊」「老张的船」「K 记冰室」',
    note: '一个名字或系列名',
  },
  {
    id: 'literary',
    label: '引语',
    hint: '借一句现成的话：成语、谚语、招牌上的字、半句诗，或一句外语短语。只取半句，不加引号，'
      + '不改写、不再加副题解释。例：「向晚意不适」「此处禁止停留」「Mala tempora」',
    note: '借一句现成的话',
  },
  {
    id: 'poetic',
    label: '并置',
    hint: '两样东西并排放：用逗号、空格或「与」连接，关系不点破。两边都必须是具体的物或具体的动作，'
      + '不许有一边是抽象词。例：「一盏灯，一条空街」「椅子与雨」「站着的和躺着的」',
    note: '两样东西并排，不解释',
  },
];

export const NARRATIVE_STYLES: StyleOption<NarrativeStyle>[] = [
  {
    id: 'essay',
    label: '照片随笔',
    hint: '从一个局部细节起笔，第二句换到稍远处的一件东西，第三句回到身上或手边；结尾停在物上，不总结。',
    note: '默认，克制有细节',
  },
  {
    id: 'documentary',
    label: '冷静纪实',
    hint: '只写看见的与能推断的，几乎不用形容词，不写内心活动。句子短，多用句号，像现场笔记：位置、数量、动作、时间。',
    note: '零抒情，接近田野笔记',
  },
  {
    id: 'prose-poem',
    label: '散文诗',
    hint: '有意象也有停顿，允许一句话里只放一个名词或一个动作；节奏靠长短句交替，而不是靠形容词堆。',
    note: '意象与节奏更强',
  },
  {
    id: 'diary',
    label: '日记体',
    hint: '第一人称，带当天的时间与场合痕迹，允许犹豫、改口、事后补充；语气私密，像写给自己看的备忘。',
    note: '像自己写给自己的字',
  },
  {
    id: 'terse',
    label: '短句硬朗',
    hint: '通篇短句，句号收尾，不连接、不解释，靠并置产生意义。全篇不许出现「因为」「所以」「于是」。',
    note: '冷硬，留白大',
  },
];

export interface LengthOption {
  id: StoryLength;
  label: string;
  min: number;
  max: number;
}

export const STORY_LENGTHS: LengthOption[] = [
  { id: 'short', label: '短（80–120 字）', min: 80, max: 120 },
  { id: 'medium', label: '中（120–200 字）', min: 120, max: 200 },
  { id: 'long', label: '长（200–300 字）', min: 200, max: 300 },
];

/**
 * 标题里高发的空泛词，提示词会明确要求避开。
 * 0.7.5 扩表：模型爱在标题末尾挂一个抽象名词凑长度（「……之间」「……之美」「……的温柔」），
 * 这类词不点名，光说「别抽象」它照样写。
 * 0.8.1 再扩：加了赛事图注里几乎不出现的「抒情名词」与「摄影腔形容词」——
 * 它们正是「像 AI 写的」的第一信号（「静谧的光影」「治愈的瞬间」「电影感的黄昏」）。
 */
export const TITLE_BANNED_WORDS = [
  '时光',
  '岁月',
  '静好',
  '温暖',
  '美好',
  '遇见',
  '回忆',
  '流年',
  '光影',
  '刹那',
  '温柔',
  '治愈',
  '小确幸',
  '人间烟火',
  '之间',
  '之美',
  '诗意',
  '远方',
  '答案',
  '告别',
  '告白',
  '相遇',
  '故事',
  '画面',
  '风景',
  '瞬间',
  '情绪',
  '氛围',
  '氛围感',
  '电影感',
  '高级感',
  '静谧',
  '治愈系',
  '孤独',
  '喧嚣',
  '斑驳',
  '缱绻',
  '呢喃',
  '浅吟',
  '诗意地',
];

/**
 * 好标题的语感参考（给模型做参照，避免只给抽象要求）。
 * 0.8.1：从「六种取景法」换成「六种赛事命名法」，并保留几条中文赛事获奖名录里的读感。
 * 注意这些都是**参照**，提示词里明确说了不许照抄。
 */
export const TITLE_EXAMPLES = [
  // 单词
  '盐',
  '守夜人',
  '退潮',
  // 无题 / 编号
  '无题 No.04',
  '码头习作 12',
  // 地名与时刻
  '青石桥，清晨五点',
  '北岸，十一月',
  '七楼，雨后',
  // 专名
  '香豌豆—友谊',
  '老张的船',
  'K 记冰室',
  // 引语
  '向晚意不适',
  '此处禁止停留',
  'Mala tempora',
  // 并置
  '一盏灯，一条空街',
  '椅子与雨',
  // 混合读感（获奖名录里最常见的几种长度）
  '视界',
  '瞬息之诗',
  '道路中隐藏的秘密',
];

export const DEFAULT_TITLE_STYLE: TitleStyle = 'literary';
export const DEFAULT_NARRATIVE_STYLE: NarrativeStyle = 'essay';
export const DEFAULT_STORY_LENGTH: StoryLength = 'medium';

export const getTitleStyle = (id?: TitleStyle): StyleOption<TitleStyle> =>
  TITLE_STYLES.find((s) => s.id === id) ?? TITLE_STYLES[0]!;

export const getNarrativeStyle = (id?: NarrativeStyle): StyleOption<NarrativeStyle> =>
  NARRATIVE_STYLES.find((s) => s.id === id) ?? NARRATIVE_STYLES[0]!;

export const getStoryLength = (id?: StoryLength): LengthOption =>
  STORY_LENGTHS.find((s) => s.id === id) ?? STORY_LENGTHS[1]!;
