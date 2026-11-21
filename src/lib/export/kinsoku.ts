// src/lib/export/kinsoku.ts
// 0.6.5：中文避头尾（禁则）规则表 + 分句。
//
// PDF 的两套引擎（竖排毫米预算 / 排版台网格）都要靠这里判断「这一行能断在
// 哪两个字之间」。规则表放在单独文件里，测量（text-measure.ts）和排版
// 只引用同一份，才不会出现「算出来的行数和浏览器断出来的行数不一样」。
//
// 避头尾的两条铁律：
//   ① 行首禁则 —— 「，。」等收尾字符不许出现在一行的开头；
//   ② 行尾禁则 —— 「（「」等起始字符不许出现在一行的末尾。
// 实现方式是「禁止在这些位置断行」：断点被禁用，浏览器与我们的测量都会
// 往前找上一个合法断点，于是标点自然跟着前一个字一起换行，既不孤立也不溢出。
'use client';

/** 行首禁则：不能出现在一行开头（句读、闭括号、闭引号、省略号、单位符号） */
const NO_START_CHARS: string[] = [
  '，',
  '。',
  '、',
  '；',
  '：',
  '！',
  '？',
  '）',
  '〕',
  '〉',
  '》',
  '」',
  '』',
  '】',
  '｝',
  '”',
  '’',
  '…',
  '‥',
  '·',
  '％',
  '%',
  '‰',
  '℃',
  '°',
  ',',
  '.',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '»',
];

/** 行尾禁则：不能出现在一行末尾（开括号、开引号） */
const NO_END_CHARS: string[] = ['（', '〔', '〈', '《', '「', '『', '【', '｛', '“', '‘', '(', '[', '{', '«'];

/** 句末标点（分句用，不参与断行判定） */
const SENTENCE_END_CHARS = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '.']);

/** 句末标点后面还属于上一句的收尾符号（把「！」的」整体归到同一句） */
const CLOSER_CHARS = new Set(['」', '』', '”', '’', '）', ')', '】', '》', '〉', '〕', '］', ']', '｝', '}', '»']);

export const NO_START = new Set(NO_START_CHARS);
export const NO_END = new Set(NO_END_CHARS);

/** 宽字符（中日韩汉字、假名、全角标点）：中文可以逐字断行 */
export function isWideChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x2e80 && cp <= 0xa4cf) return true; // 部首扩展 / 假名 / 汉字
  if (cp >= 0xac00 && cp <= 0xd7a3) return true; // 谚文音节
  if (cp >= 0xf900 && cp <= 0xfaff) return true; // 兼容汉字
  if (cp >= 0xfe30 && cp <= 0xfe4f) return true; // 竖排/兼容标点
  if (cp >= 0xff00 && cp <= 0xff60) return true; // 全角 ASCII / 全角标点
  if (cp >= 0xffe0 && cp <= 0xffe6) return true; // 全角符号
  return false;
}

/**
 * chars[i] 与 chars[i + 1] 之间是否允许断行。
 * 注意：这里问的是「断点」，不是「字符」——被禁用的断点会让整个词一起换行。
 */
export function canBreakAfterAt(chars: string[], i: number): boolean {
  const a = chars[i];
  const b = chars[i + 1];
  if (a === undefined || b === undefined) return false;

  // ① 开括号 / 开引号后面不断：否则「（」会孤零零留在行尾
  if (NO_END.has(a)) return false;
  // ② 闭括号 / 闭引号 / 句读前面不断：否则「，」会跑到行首
  if (NO_START.has(b)) return false;
  // ③ 破折号、省略号是成对的两个字，从中间拆开很难看
  if ((a === '—' && b === '—') || (a === '…' && b === '…')) return false;

  // ④ 空格后面可以断（换行时行首空白会被吃掉）
  if (a === ' ') return true;
  // ⑤ 连字符 / 斜杠后面可以断，但数字里的「1/30s」「2025-11-21」不许拆
  //    （Chromium 按 UAX#14 把两边都是数字的 / - 当数值连写，这里必须跟它一致，
  //     否则我们会把「1/30s」的「30s」塞进上一行、算出来的行数比真实排版少一行）
  if (a === '-' || a === '/' || a === '\u2013') {
    const prev = chars[i - 1];
    const next = b;
    const numeric = !!prev && /[0-9]/.test(prev) && /[0-9]/.test(next);
    return !numeric;
  }

  // ⑥ 中文逐字可断；中文与西文交界也可以断
  if (isWideChar(a) || isWideChar(b)) return true;

  // ⑦ 其余位置（西文单词内部）不断，交给「超长单词强制断字」兜底
  return false;
}

/**
 * 分句：按句末标点切，句末标点（含紧跟的闭引号、连续省略号）留在前一句里。
 * 网格里的超长正文需要「按整句缩短」——宁可少印一句完整的话，
 * 也不要出现半句被截掉的残句。
 */
export function splitSentences(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === '\n') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
    if (!SENTENCE_END_CHARS.has(ch)) continue;
    // 小数点 / 版本号 / URL 里的「.」不是句末
    if (ch === '.') {
      const next = chars[i + 1];
      if (next && /[0-9A-Za-z_/-]/.test(next)) continue;
    }
    // 句末标点后面紧跟的闭引号、闭括号、连续省略号仍属于这一句
    let j = i + 1;
    while (j < chars.length) {
      const n = chars[j];
      if (CLOSER_CHARS.has(n) || SENTENCE_END_CHARS.has(n)) {
        buf += n;
        j += 1;
        continue;
      }
      break;
    }
    i = j - 1;
    out.push(buf.trim());
    buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** 收尾字符集（给「省略号不能落在行尾禁则之后」之类的收尾判断用） */
export function endsWithOpenPunct(text: string): boolean {
  if (!text) return false;
  const chars = Array.from(text);
  return NO_END.has(chars[chars.length - 1]);
}
