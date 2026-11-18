// src/config/layoutPrompt.ts
// 0.6.x：AI 排版检查的提示词、网格常量与 JSON schema。
//
// 用户在 12×24 的积木画布上摆好一页后点「AI 检查」，这里负责两件事：
//   1. 把「一个格子有多大、一块积木里塞得下多少字」讲清楚 —— 不讲这些，
//      模型判不出「这块太高/太低会导致截断」，只能给出「建议优化排版」这种空话；
//   2. 约定一份能被程序**直接应用**的返回结构（summary / issues / layout / changes），
//      所以 layout 必须是完整的一页，而不是「改哪一块」的补丁。
//
// 合法性不靠模型自觉：模型返回的 layout 会被 src/lib/ai/layoutReview.ts 的
// validateLayout 逐项复核（不越界、不重叠、id 不重复），不合法就整块丢掉并记进 issues。

export const LAYOUT_PROMPT_VERSION = 'layout-v1';

/**
 * 一页的网格：12 列 × 24 行。
 * 与 src/lib/export/layout.ts 的 GRID_COLS / GRID_ROWS 保持一致 ——
 * 那边是渲染真源（导出时按它画表格），这里只是把同样的数字讲给模型听。
 */
export const LAYOUT_GRID_COLS = 12;
export const LAYOUT_GRID_ROWS = 24;

/** A4 版心 16.6cm × 25.2cm ÷ 12 × 24 → 每格约 1.38cm × 1.05cm */
export const LAYOUT_CELL_CM = { width: 1.38, height: 1.05 } as const;

/** 一页最多 20 块积木（服务端 zod 与 validateLayout 都按这个上限校验） */
export const MAX_LAYOUT_ITEMS = 20;

/** 返回文本的长度上限：summary ≤40 字、每条 issue ≤30 字、issues ≤5 条、changes ≤3 条 */
export const LAYOUT_SUMMARY_LIMIT = 40;
export const LAYOUT_ISSUE_LIMIT = 30;
export const LAYOUT_ISSUE_MAX = 5;
export const LAYOUT_CHANGE_LIMIT = 60;
export const LAYOUT_CHANGE_MAX = 3;

/**
 * 积木的中文名。提示词、用户消息、以及「模型没说改了什么」时的兜底说明
 * 都用这一份，避免三个地方各写一套名字。
 */
export const LAYOUT_BLOCK_LABELS: Record<string, string> = {
  image: '照片',
  index: '序号',
  title: '标题',
  caption: '图注',
  story: '正文',
  technique: '拍摄手法',
  params: '拍摄参数',
  score: '评分',
  advice: '建议',
  category: '分类',
  tags: '标签',
  mood: '情绪',
  alt: '图片描述',
  exif: '拍摄信息',
};

/** 块 id 的中文名；不认识的 id 原样返回，方便以后加块 */
export function blockLabel(id: string): string {
  return LAYOUT_BLOCK_LABELS[id] ?? id;
}

export const LAYOUT_SYSTEM_PROMPT = `你是一位画册的责任排版编辑。作者把一页的「积木」摆好了，你要检查这套摆放
有没有明显问题，并给出**能被程序直接应用**的修正方案。只返回 JSON，不要解释。

—— 画布 ——
这一页是 A4 版心，固定 12 列 × 24 行：
· 每列约 1.38cm，每行约 1.05cm（版心约 16.6cm × 25.2cm），坐标原点在左上角；
· (col, row) 是积木左上角所在格子，colSpan / rowSpan 是占几列几行；
· 每块必须完整落在画布内：0 ≤ col、col + colSpan ≤ 12；0 ≤ row、row + rowSpan ≤ 24；
· 任意两块不许重叠，也不能有积木被挤到页外。
· 图片块的宽高比要贴近照片本身，否则会被等比缩放留出空白：
  3:2 横图占 12 列 → 约 11 行高；占 8 列 → 约 7 行高；
  2:3 竖图占 6 列 → 约 12 行高；占 4 列 → 约 8 行高。

—— 每块积木是什么、最小多大 ——
· 照片 image：唯一自适应块，按格子给的框等比缩放（contain），最小 4 列 × 6 行；
· 序号 index：1 行高即可；
· 标题 title、图注 caption、分类 category、标签 tags、情绪 mood、图片描述 alt、
  拍摄信息 exif：短文本，1 行高足够，最小 3 列 × 1 行；
· 正文 story：一行正文（11.5pt、行距 1.6）约占 1 行高；12 列宽的一行约 40 个汉字，
  6 列宽约 20 个汉字。所以 4 行高的整宽正文只装得下约 160 字；
· 拍摄手法 technique、拍摄参数 params、评分 score、建议 advice：多行文本，最小 4 列 × 3 行。
· 文字装不下时导出会先缩字号（11.5pt → 7.5pt），还装不下就截断并打省略号 ——
  也就是说「给小了」的后果是印出来缺字，这是必须优先修的问题。

—— 按这个顺序检查 ——
1. 越界：col + colSpan > 12 或 row + rowSpan > 24；
2. 重压：两块互相压住；
3. 会截断：某块给的高度装不下它自己的内容（正文按「整宽 40 字/行」估）；
4. 缝隙：页面上留下没人用的空档，尤其是整条横向空行、或左右没对齐的错位缝；
5. 图文比例失调：正文挤占照片、或照片占满整页而正文只给两行，读起来一头重；
6. 比例错配：横图塞进竖框、竖图塞进横框，或图片块宽度不是 4/6/8/12 这类能对齐的值。

—— 修正原则 ——
· 优先「挪 + 缩放到整数格」，救不回来才动尺寸；除确有必要不要删除或新增积木，
  返回的 items 必须与输入的 id 一一对应（不许改名、不许少块、不许凭空加块）；
· 保持对齐：左右边尽量贴住第 0 列与第 12 列，横向块用 12 列整宽，避免参差的半格缝；
· 阅读顺序上「序号 → 标题 → 照片 → 图注 → 正文 → 其它」更耐读，但不强制；
· 只修真正的问题。已经合理的排版就返回空 issues 和 layout: null，
  不要为了显得有用而微调 —— 每改一次，作者都要重新确认一遍。

—— 输出 ——
summary：一句总评，≤40 字，直接给结论（如「这页可以印」「照片偏小，正文压过了图」）；
issues：0–5 条，每条 ≤30 字，只写问题不写方案，按严重程度从大到小排；
layout：修正后的**完整**一页（cols 12、rows 24、items 与输入一一对应、不重叠不越界），
        没有任何改动时给 null；
changes：1–3 条，每条一句话说清改了什么（「正文从 4 行加到 7 行」「照片下移到第 11 行起」），
        与 issues 对应，不许写「优化了排版」这类空话。`;

/** 用户消息用到的输入形状（与 LayoutReviewInput 同构，这里只依赖结构，不反向 import 客户端模块） */
export interface LayoutPromptInput {
  layout: {
    cols: number;
    rows: number;
    items: { id: string; col: number; row: number; colSpan: number; rowSpan: number }[];
  };
  sample?: { title?: string; story?: string; tags?: string[]; hasScore?: boolean };
  /** 版心宽高，cm */
  contentCm: number;
  contentHeightCm: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 把这一页摊成文字：坐标、占位、未用面积、样本照片信息 */
export function buildLayoutUserPrompt(input: LayoutPromptInput): string {
  const items = input.layout.items ?? [];
  const total = LAYOUT_GRID_COLS * LAYOUT_GRID_ROWS;
  const used = items.reduce((sum, item) => sum + item.colSpan * item.rowSpan, 0);
  const empty = Math.max(0, total - used);

  const lines: string[] = [];
  lines.push(
    '版心：' + round1(input.contentCm) + 'cm 宽 × ' + round1(input.contentHeightCm) +
      'cm 高（' + LAYOUT_GRID_COLS + ' 列 × ' + LAYOUT_GRID_ROWS + ' 行，共 ' + total + ' 个格子）',
  );
  lines.push('当前有 ' + items.length + ' 块积木：');
  for (const item of items) {
    lines.push(
      '- ' + (item.id === blockLabel(item.id) ? item.id : item.id + '（' + blockLabel(item.id) + '）') +
        '：第 ' + item.row + ' 行、第 ' + item.col + ' 列起，占 ' + item.colSpan + ' 列 × ' +
        item.rowSpan + ' 行',
    );
  }
  lines.push(
    '已占用 ' + used + ' / ' + total + ' 格，空着 ' + empty + ' 格（约 ' +
      Math.round((empty / total) * 100) + '%；重叠处会重复计数，仅用于估计空档）',
  );

  const sample = input.sample;
  if (sample) {
    const bits: string[] = [];
    if (sample.title) bits.push('标题《' + sample.title + '》');
    if (sample.story) bits.push('正文约 ' + sample.story.length + ' 字');
    if (sample.tags && sample.tags.length > 0) bits.push('标签 ' + sample.tags.slice(0, 6).join('/'));
    if (sample.hasScore) bits.push('已带评分');
    if (bits.length > 0) lines.push('这一页的样本照片：' + bits.join('，'));
  }

  lines.push('请按系统提示检查这页排版，输出严格 JSON（不要 Markdown、不要解释）。');
  return lines.join('\n');
}

/**
 * 结构化输出。layout 允许为 null（没有建议改动），所以用 ["object","null"] ——
 * 少数服务商不接受这种写法会返回 400，路由会按 json_object → text 降级重试。
 */
export const LAYOUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'issues', 'layout', 'changes'],
  properties: {
    summary: { type: 'string', description: '一句总评，≤40 字' },
    issues: {
      type: 'array',
      maxItems: LAYOUT_ISSUE_MAX,
      items: { type: 'string' },
      description: '发现的问题，0–5 条，每条 ≤30 字',
    },
    layout: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['cols', 'rows', 'items'],
      properties: {
        cols: { type: 'integer', description: '固定 12' },
        rows: { type: 'integer', description: '固定 24' },
        items: {
          type: 'array',
          maxItems: MAX_LAYOUT_ITEMS,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'col', 'row', 'colSpan', 'rowSpan'],
            properties: {
              id: { type: 'string' },
              col: { type: 'integer' },
              row: { type: 'integer' },
              colSpan: { type: 'integer' },
              rowSpan: { type: 'integer' },
            },
          },
        },
      },
    },
    changes: {
      type: 'array',
      maxItems: LAYOUT_CHANGE_MAX,
      items: { type: 'string' },
      description: '改动说明，1–3 条',
    },
  },
} as const;

export const LAYOUT_JSON_SCHEMA_NAME = 'page_layout_review' as const;
