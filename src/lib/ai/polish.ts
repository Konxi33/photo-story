// src/lib/ai/polish.ts
// 文案的确定性收尾（0.7.5）。
//
// 为什么要有这一层：提示词只能「要求」模型，拦不住它偶尔漏出来的模板腔。
// 每次重新生成都花钱，用户也不可能一条条手改标题，所以把**能机械判定**的毛病
// 在这里直接修掉：多余引号、标题里的句号、半角标点、「仿佛」这类软词、
// 「进行＋动词」这种公文腔、开头的「在这张照片里」、结尾的感叹号。
//
// 这一层只做保守修改：删掉、替换、统一标点。不改写内容，不新增信息。
// 同一批照片的标题去重也在这里（标题撞车是最容易被看出来的破绽）。

import type { PhotoAnalysis } from '@/types/domain';

/** 单个分析结果的收尾报告，方便开发时看「到底改了什么」 */
export interface PolishNote {
  field: 'title' | 'story' | 'mood' | 'alt' | 'bullets';
  from: string;
  to: string;
  reason: string;
}

export interface PolishResult {
  analysis: PhotoAnalysis;
  notes: PolishNote[];
}

/* ------------------------------- 词表 ------------------------------- */

/** 出现在标题里就等于「AI 标题」的词，直接剔除 */
const TITLE_POISON = [
  '时光',
  '岁月',
  '静好',
  '流年',
  '光影',
  '刹那',
  '温柔',
  '治愈',
  '小确幸',
  '人间烟火',
  '诗意',
  '之美',
  '之间',
  '远方',
  '答案',
];

/** 软词替换：这些词一出现，句子立刻变「文案」。能做等义替换的就替换。 */
const SOFT_REPLACEMENTS: [RegExp, string][] = [
  [/仿佛/g, '像'],
  [/宛如/g, '像'],
  [/犹如/g, '像'],
  [/似乎有点/g, '有点'],
  [/不禁让人想起/g, '让人想起'],
  [/不由得/g, ''],
  [/让人不禁/g, '让人'],
  [/在这一瞬间/g, '那一会儿'],
  [/这一刻/g, '这会儿'],
  [/定格了/g, '停住了'],
  [/定格在/g, '停在'],
  [/定格/g, '停住'],
];

/** 公文腔 / AI 结构词：整段删掉比替换好，因为它们几乎总是废句的起手 */
const CLICHE_PHRASES = [
  '值得一提的是',
  '不容忽视的是',
  '不难发现',
  '可以看出',
  '整体来看',
  '总的来说',
  '综上所述',
  '给人一种',
];

/** 句首的「报幕词」，删掉直接从具体东西写起 */
const OPENING_BOILERPLATE = [
  '在这张照片里，',
  '在这张照片中，',
  '这张照片里，',
  '这张照片中，',
  '在这张作品中，',
  '画面中，',
  '画面里，',
  '照片中，',
  '在这里，',
  '在这里',
];

/* ------------------------------ 工具函数 ------------------------------ */

const HALF_TO_FULL: [RegExp, string][] = [
  [/,/g, '，'],
  [/;/g, '；'],
  [/:/g, '：'],
  [/\?/g, '？'],
  [/\b!/g, '！'],
];

const collapse = (text: string): string => text.replace(/[ \t\u00a0]+/g, ' ').trim();

/** 统一中文标点：半角逗号/分号/冒号/问号转全角，去掉感叹号（图注不用感叹号） */
function unifyPunctuation(text: string): string {
  let out = text;
  for (const [pattern, replacement] of HALF_TO_FULL) out = out.replace(pattern, replacement);
  out = out.replace(/！+/g, '。');
  out = out.replace(/\.{3,}/g, '……');
  out = out.replace(/。{2,}/g, '。');
  out = out.replace(/，，+/g, '，');
  out = out.replace(/、{2,}/g, '、');
  out = out.replace(/[，、]{1,}。/g, '。');
  // 括号里空了就删掉
  out = out.replace(/（\s*）/g, '').replace(/\(\s*\)/g, '');
  return out;
}

/* ------------------------------- 标题 ------------------------------- */

/**
 * 标题收尾：去引号书名号、去标点、去毒词、压到 4–10 字。
 * 压长度时优先在标点处断，其次在「的」前断，实在不行才硬截。
 *
 * 坑（0.7.5 实测）：「《时光里的温柔》」剔掉「时光」「温柔」后只剩一个「里」——
 * 毒词剔完必须校验结果是否还像标题，太短就从正文里捞一个具体物名兜底，
 * 绝不能把「里」「的」这种残渣当标题交出去。
 */
export function polishTitle(
  raw: string,
  hints: { story?: string } = {},
): { title: string; notes: PolishNote[] } {
  const notes: PolishNote[] = [];
  const original = collapse(raw);

  let title = original
    .replace(/^[《〈「『"“'']+/, '')
    .replace(/[》〉」』"”'']+$/, '')
    .replace(/[。，、；：！？…—·]+/g, '')
    .trim();

  if (title !== original) {
    notes.push({ field: 'title', from: original, to: title, reason: '去掉引号与句读' });
  }

  let touched = false;
  for (const word of TITLE_POISON) {
    if (title.includes(word)) {
      const before = title;
      title = title.replace(new RegExp(word, 'g'), '');
      touched = true;
      notes.push({ field: 'title', from: before, to: title, reason: '剔除空泛词「' + word + '」' });
    }
  }

  // 只在「刚剔过词」的时候清理接缝处的连接字（「时光里的温柔」→「里」）。
  // 没剔过词的标题一个字都不能动：「副驾驶的空位」里的「的」是标题的一部分。
  if (touched) {
    title = title.replace(/^[的之里中在与和]+|[的之里中在与和]+$/g, '').trim();
  }

  if (title.length > 10) {
    const cut = Math.max(title.lastIndexOf('，'), title.lastIndexOf('的'), title.lastIndexOf('与'));
    const next = cut >= 4 ? title.slice(0, cut) : title.slice(0, 10);
    notes.push({ field: 'title', from: title, to: next, reason: '超过 10 字' });
    title = next;
  }

  // 剔词剔空了，或只剩一两个字：从正文里捞一个具体物名当标题
  if (title.length < 4 && hints.story) {
    const rescued = rescueTitleFromStory(hints.story);
    if (rescued) {
      notes.push({ field: 'title', from: original, to: rescued, reason: '剔词后不成词，改从正文取物名' });
      title = rescued;
    }
  }

  title = title.trim();
  if (title.length === 0) {
    notes.push({ field: 'title', from: original, to: '未命名', reason: '清空后为空' });
    title = '未命名';
  }

  return { title, notes };
}

const STOP_CHUNKS = new Set(['一个', '这个', '那个', '这里', '那里', '什么', '很多', '时候', '之后', '然后']);

const TAIL_NOISE = /(洒在|落在|停在|挂在|放在|走在|站在|坐在|看着|笑着|走了|来了|很好|不错|很美)+$/;
/** 名词短语后面粘上的动词/助词尾巴，逐字剥到干净为止 */
const TAIL_VERB = /[在着过了是很好洒落停挂放走站坐看笑照吹飘擦堆摆]+$/;

function trimNounTail(text: string): string {
  let out = text.replace(TAIL_NOISE, '');
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(TAIL_VERB, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * 从正文里挑一个像「物名」的 4–10 字块当标题。
 * 优先级：偏正短语（X的Y）> 去掉动词尾巴的短句。
 * 只收名词性的东西 —— 「夕阳的余晖洒在」这种半截句子当标题最难看。
 */
function rescueTitleFromStory(story: string): string | null {
  const clauses = story
    .split(/[、，；：]/)
    .map((part) => part.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').trim())
    .filter((part) => part.length >= 2);

  let fallback: string | null = null;
  for (const clause of clauses) {
    const phrase = clause.match(/[\u4e00-\u9fa5]{2,4}的[\u4e00-\u9fa5]{2,4}/)?.[0];
    const clean = phrase ? trimNounTail(phrase) : '';
    if (clean.length >= 4 && clean.length <= 10) return clean;

    const trimmed = trimNounTail(clause);
    if (trimmed.length >= 4 && trimmed.length <= 10 && !STOP_CHUNKS.has(trimmed) && !fallback) {
      fallback = trimmed;
    }
  }
  return fallback;
}

/* ------------------------------- 正文 ------------------------------- */

/** 正文收尾：删报幕词、换软词、删废句、统一标点、保证结尾是句号 */
export function polishStory(raw: string): { story: string; notes: PolishNote[] } {
  const notes: PolishNote[] = [];
  const original = collapse(raw);
  let story = original;

  for (const prefix of OPENING_BOILERPLATE) {
    if (story.startsWith(prefix)) {
      story = story.slice(prefix.length);
      notes.push({ field: 'story', from: original, to: story, reason: '去掉开头的报幕词' });
      break;
    }
  }

  for (const [pattern, replacement] of SOFT_REPLACEMENTS) {
    if (pattern.test(story)) {
      story = story.replace(pattern, replacement);
      notes.push({ field: 'story', from: original, to: story, reason: '软化词替换' });
      pattern.lastIndex = 0;
    }
  }

  // 万能抒情词在正文里不留：它们几乎总是形容词位置上的填充物（「时光的美好」「岁月的痕迹」）
  const beforePoison = story;
  story = story
    .replace(/(时光|岁月|流年|光阴)的/g, '')
    .replace(/(时光|岁月|流年|光阴|治愈|氛围感|高级感|故事感)/g, '');
  if (story !== beforePoison) {
    notes.push({ field: 'story', from: beforePoison, to: story, reason: '删掉万能抒情词' });
  }

  for (const phrase of CLICHE_PHRASES) {
    if (!story.includes(phrase)) continue;
    const before = story;
    // 只摘掉套话本身，不整句删 —— 整句删会把「值得一提的是，画面里的车流很多」
    // 这种句子连着事实一起删掉，实测能删成空字符串。
    story = story.replace(new RegExp(phrase + '[是，,]{0,2}', 'g'), '');
    notes.push({ field: 'story', from: before, to: story, reason: '删掉套话「' + phrase + '」' });
  }

  // 摘完套话后可能留下残句（「，画面里的车流很多」），清掉开头的标点与短残句
  story = story.replace(/^[，、；。]+/, '');
  const kept = story
    .split('。')
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (kept.length > 0) story = kept.join('。') + '。';
  else return { story: unifyPunctuation(original.replace(/\s+/g, '')).trim(), notes };

  // 「进行拍摄」「进行观察」→「拍摄」「观察」
  story = story.replace(/进行([\u4e00-\u9fa5]{2})/g, '$1');
  story = unifyPunctuation(story);
  story = story.replace(/\s+/g, '');

  if (story.length > 0 && !/[。？！…]$/.test(story)) story += '。';

  return { story: story.trim(), notes };
}

/* ------------------------------- 条目 ------------------------------- */

/** 列表项（为什么好看 / 建议）：去尾部标点与多余空格，超长截断 */
export function polishBullets(items: string[] | undefined, limit: number): string[] {
  const out: string[] = [];
  for (const raw of items ?? []) {
    const text = collapse(raw).replace(/[。；;，,]+$/, '');
    if (!text) continue;
    out.push(text.length > limit ? text.slice(0, limit) : text);
  }
  return out;
}

/* ------------------------------- 汇总 ------------------------------- */

export interface PolishOptions {
  /** 同批已用过的标题，用来避免重名与近义改写 */
  usedTitles?: string[];
}

/** 判断两个标题是否「太像」：完全相等，或去掉标点后相等，或互为子串 */
function isNearDuplicate(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 3 && y.includes(x)) return true;
  if (y.length >= 3 && x.includes(y)) return true;
  return false;
}

/**
 * 最后一道工序：修标题、修正文、修列表，并处理同批标题重复。
 * 标题撞车时不再重命名（模型没给候选，硬编一个反而更假），
 * 而是在标题后落一个画面性质的后缀，如「（第二张）」不合适——
 * 所以这里只做「换一个不重复的短后缀」：取正文里第一个具体物名。
 */
export function polishAnalysis(analysis: PhotoAnalysis, options: PolishOptions = {}): PolishResult {
  const notes: PolishNote[] = [];

  // 先修正文，再修标题：标题剔词剔空了要从「已修正的正文」里捞物名，
  // 用原始正文会把「在这张照片中」这种报幕词捞成标题。
  const storyResult = polishStory(analysis.story);
  notes.push(...storyResult.notes);

  const titleResult = polishTitle(analysis.title, { story: storyResult.story });
  notes.push(...titleResult.notes);
  let title = titleResult.title;

  const used = options.usedTitles ?? [];
  if (used.some((t) => isNearDuplicate(t, title))) {
    const before = title;
    // 从正文里找一个 2–4 字的具体物名当后缀，找不到就用序数兜底
    const body = analysis.story ?? '';
    const candidate = body.match(/[\u4e00-\u9fa5]{2,4}(?=[，。、]|$)/)?.[0];
    title = candidate && !used.some((t) => isNearDuplicate(t, candidate)) ? candidate : `${title}·二`;
    notes.push({ field: 'title', from: before, to: title, reason: '同批重名' });
  }

  const mood = collapse(analysis.mood)
    .split(/[、,，/\s]+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('·');

  const alt = collapse(analysis.alt).replace(/[。；;]+$/, '');

  return {
    analysis: {
      ...analysis,
      title,
      story: storyResult.story,
      mood,
      alt,
      whyGood: polishBullets(analysis.whyGood, 24),
      improve: polishBullets(analysis.improve, 24),
      imitate: polishBullets(analysis.imitate, 24),
      scoreAdvice: polishBullets(analysis.scoreAdvice, 28),
      tags: (analysis.tags ?? [])
        .map((t) => collapse(t).replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 6),
    },
    notes,
  };
}

/** 只跑一遍检查、不改写：给「文案体检」之类的界面功能用 */
export function scanTextQuality(text: string): { score: number; issues: string[] } {
  const issues: string[] = [];
  if (/仿佛|似乎|宛如|犹如/.test(text)) issues.push('出现软词（仿佛/似乎/宛如）');
  if (/进行[\u4e00-\u9fa5]{2}/.test(text)) issues.push('出现「进行＋动词」');
  if (/值得一提的是|不难发现|整体来看|可以看出/.test(text)) issues.push('出现套话');
  if (/！/.test(text)) issues.push('用了感叹号');
  if (/时光|岁月|治愈|氛围感|高级感/.test(text)) issues.push('出现万能抒情词');
  if (/^在这张照片|^画面中/.test(text)) issues.push('以报幕词开头');
  const sentences = text.split(/[。？！]/).filter((s) => s.trim().length > 0);
  if (sentences.length >= 3) {
    const lengths = sentences.map((s) => s.length);
    if (Math.max(...lengths) - Math.min(...lengths) < 6) issues.push('句子长度太均匀');
  }
  return { score: Math.max(0, 100 - issues.length * 15), issues };
}
