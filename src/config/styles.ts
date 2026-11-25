// src/config/styles.ts
// AI 文案风格目录：标题风格 / 叙事风格 / 字数档位。
// 改这里的 hint 就会改变生成结果，不需要动 prompts.ts 的主结构。
//
// 0.7.5：hint 从「一句话形容词」改成「写法的具体动作 + 两个例子」。
// 之前写「有画面感的物象标题」，模型只能理解成「加形容词」；
// 写成「从画面角落挑一件不起眼的东西，只写它和它周围」，它才会真的去指物。

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
    hint: '从画面角落挑一件不起眼的东西（绳结、贴纸、半开的窗），只写它本身和它周围几厘米，不解释寓意。例：「刚拧干的抹布」「贴歪的价签」',
    note: '有画面感的物象标题',
  },
  {
    id: 'concise',
    label: '四字凝练',
    hint: '2–4 个字，像国画题签或器物名：一个偏正短语或动宾短语，宁可生硬也不要顺口。例：「断墙」「空椅」「半盏」',
    note: '短促有力，像国画题签',
  },
  {
    id: 'poetic',
    label: '诗性对仗',
    hint: '两截并排，之间不动声色地对不上（一处亮一处暗、一件新一件旧），不加感叹词。例：「檐下无雨」「亮着的店，关着的门」',
    note: '有张力的短句',
  },
  {
    id: 'cinematic',
    label: '电影片名',
    hint: '像某个镜头的名字，含一点时间或方位感，读起来是一个场景而不是一种心情。例：「开往北边的车」「午后三点零七分」',
    note: '像独立电影片名',
  },
  {
    id: 'plain',
    label: '朴素纪实',
    hint: '白描式陈述：谁在做什么、东西放在哪，一个字都不修饰。例：「搬家的下午」「楼下的面馆」',
    note: '平实，几乎不带形容词',
  },
  {
    id: 'symbol',
    label: '隐喻象征',
    hint: '让画面里的一件东西替人说话，但不能说破，也不要出现「意义」「答案」这类词。例：「等一场没来的雨」「第二遍关门」',
    note: '有寓意，留白到读者自己懂',
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
];

/** 好标题示例（给模型做参照，避免只给抽象要求）。按「先看局面」的六种取景法分组。 */
export const TITLE_EXAMPLES = [
  // 时刻与光
  '光只到了半条街',
  '四点后的斜光',
  '天光刚落到台阶上',
  // 天气与空气
  '雨停之前',
  '风把雨棚掀起来',
  '冷得没人愿意停',
  // 距离与位置
  '隔着两条车道',
  '从七楼往下看',
  '停在没人的路边',
  // 关系
  '亮着的店，关着的门',
  '他走在前面，狗跟在后面',
  '一个人的副驾',
  // 动作到哪一步
  '还没关上的门',
  '正要开走',
  '回头之前',
  // 声音与温度
  '喇叭按了两下',
  '下午三点，杯子还烫手',
  '刚熄火，车灯还亮着',
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
