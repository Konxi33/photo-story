// src/lib/changelog.ts
// 更新日志的分类与统计。
// 0.5.3：条目不再平铺。这里把每条按「新增 / 优化 / 修复」归类，
// 页面再来决定哪些展开、哪些折叠，避免一整屏密密麻麻的字。

export type ChangelogKind = 'new' | 'polish' | 'fix';

export interface ChangelogMeta {
  /** 归类结果 */
  kind: ChangelogKind;
  /** 去掉前缀动词后的正文，读起来更短 */
  text: string;
}

export interface KindMeta {
  id: ChangelogKind;
  label: string;
  /** 一条极短的说明，用于分组标题右侧 */
  hint: string;
}

export const CHANGELOG_KINDS: KindMeta[] = [
  { id: 'new', label: '新增功能', hint: '以前没有的' },
  { id: 'polish', label: '体验优化', hint: '用起来更顺' },
  { id: 'fix', label: '问题修复', hint: '本来就该正常' },
];

const FIX_RE = /^(修复|修掉|修好)|修复了|修掉了|\bbug\b/i;
const NEW_RE = /^(新增|增加|加入|新加|上线|支持)|新增了/;

/**
 * 归类规则：先看开头动词，再看句子里有没有关键词。
 * 不用给 200 多条历史记录逐条打标签——规则命中的占绝大多数，
 * 剩下的按「优化」处理是最不容易出错的选择。
 */
export function classifyItem(item: string): ChangelogKind {
  if (FIX_RE.test(item)) return 'fix';
  if (NEW_RE.test(item)) return 'new';
  return 'polish';
}

/** 去掉「新增/修复」这类前缀，让列表正文更短（前缀已经由分组标题表达） */
export function stripPrefix(item: string): string {
  return item
    .replace(/^(新增|增加|加入|新加|上线|支持)(「[^」]*」)?[:：、,，]?\s*/, '')
    .replace(/^(修复|修掉|修好)(了)?[:：、,，]?\s*/, '')
    .replace(/^「/, '「');
}

export function classifyItems(items: string[]): ChangelogMeta[] {
  return items.map((item) => {
    const kind = classifyItem(item);
    const text = stripPrefix(item);
    return { kind, text: text.length > 0 ? text : item };
  });
}

export interface KindCount {
  kind: ChangelogKind;
  count: number;
}

export function countKinds(metas: ChangelogMeta[]): KindCount[] {
  return CHANGELOG_KINDS.map(({ id }) => ({
    kind: id,
    count: metas.filter((m) => m.kind === id).length,
  })).filter((c) => c.count > 0);
}