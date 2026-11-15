// src/config/styles.ts
// AI 文案风格目录：标题风格 / 叙事风格 / 字数档位。
// 改这里的 hint 就会改变生成结果，不需要动 prompts.ts 的主结构。

import type { NarrativeStyle, StoryLength, TitleStyle } from '@/types/domain';

export interface StyleOption<T extends string> {
  id: T;
  label: string;
  /** 写进提示词的具体要求 */
  hint: string;
  /** UI 上的一句话说明 */
  note: string;
}

export const TITLE_STYLES: StyleOption<TitleStyle>[] = [
  {
    id: 'literary',
    label: '文学意象',
    hint: '用一个具体的物象或动作承载情绪（如「铁皮上的雨」「第三根电线杆」），不要用时间、心情类抽象词',
    note: '有画面感的物象标题',
  },
  {
    id: 'concise',
    label: '四字凝练',
    hint: '2–4 个汉字，像画题或旧诗的题眼，宁可生硬也不要俗套（如「断墙」「空椅」）',
    note: '短促有力，像国画题签',
  },
  {
    id: 'poetic',
    label: '诗性对仗',
    hint: '前后两截形成轻微矛盾或张力（如「檐下无雨」「明亮的路灯与很暗的人」）',
    note: '有张力的短句',
  },
  {
    id: 'cinematic',
    label: '电影片名',
    hint: '像一个镜头的名字，隐含场景与时间感（如「开往北边的车」「午后三点零七分」）',
    note: '像独立电影片名',
  },
  {
    id: 'plain',
    label: '朴素纪实',
    hint: '陈述式白描，不加修饰（如「搬家的下午」「楼下的面馆」）',
    note: '平实，几乎不带形容词',
  },
  {
    id: 'symbol',
    label: '隐喻象征',
    hint: '点出画面背后的意义，但不能说破（如「等一场没来的雨」「第二遍关门」）',
    note: '有寓意，留白到读者自己懂',
  },
];

export const NARRATIVE_STYLES: StyleOption<NarrativeStyle>[] = [
  {
    id: 'essay',
    label: '照片随笔',
    hint: '像摄影集里的短文：从一个细节起笔，写观察与感受，结尾落回画面，不总结人生',
    note: '默认，克制有细节',
  },
  {
    id: 'documentary',
    label: '冷静纪实',
    hint: '只描述看到的与可推断的，几乎不用形容词，不写内心活动，句子短，像现场记录',
    note: '零抒情，接近田野笔记',
  },
  {
    id: 'prose-poem',
    label: '散文诗',
    hint: '分行意识、意象密集、节奏起伏，但仍保持具体，不堆砌华丽词',
    note: '意象与节奏更强',
  },
  {
    id: 'diary',
    label: '日记体',
    hint: '第一人称，带时间与场合的痕迹，语气私人化，允许一点犹豫和停顿',
    note: '像自己写给自己的字',
  },
  {
    id: 'terse',
    label: '短句硬朗',
    hint: '通篇短句，句号收尾，不连接、不解释，靠并置产生意义',
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

/** 标题里高发的空泛词，提示词会明确要求避开 */
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
];

/** 好标题示例（给模型做参照，避免只给抽象要求） */
export const TITLE_EXAMPLES = [
  '铁皮上的雨',
  '第三根电线杆',
  '明亮的路灯与很暗的人',
  '第二遍关门',
  '搬家的下午',
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
