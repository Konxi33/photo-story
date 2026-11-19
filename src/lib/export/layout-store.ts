// src/lib/export/layout-store.ts
// 排版方案库：把排版台摆好的画布存成「方案」，同一项目可以有多套
// （比如「摄影集」「参赛投稿」各存一套），换项目时也能直接搬过去用。
//
// 存在 kv 里而不是项目里，理由：
// - 项目里只保留「当前生效的那一套」（exportSettings.grid），
// - 方案是用户的素材库，跨项目复用，删项目不该把方案一起删掉。

import { KvRepository } from '@/lib/db';
import type { PageLayout } from '@/lib/export/layout';

const LAYOUTS_KEY = 'ps:layouts';
const MAX_LAYOUTS = 30;

export interface SavedLayout {
  id: string;
  name: string;
  /** 记下是从哪个项目摆出来的，方便用户认 */
  projectId?: string;
  layout: PageLayout;
  savedAt: number;
}

function makeId(): string {
  return `lay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 只留结构上合法的字段，避免把脏数据写进库 */
function normalize(layout: PageLayout): PageLayout {
  return {
    cols: Number(layout.cols) || 12,
    rows: Number(layout.rows) || 24,
    items: (layout.items ?? []).map((item) => ({
      id: item.id,
      col: Math.max(0, Math.round(item.col)),
      row: Math.max(0, Math.round(item.row)),
      colSpan: Math.max(1, Math.round(item.colSpan)),
      rowSpan: Math.max(1, Math.round(item.rowSpan)),
    })),
  };
}

export async function listLayouts(): Promise<SavedLayout[]> {
  const rows = await KvRepository.get<SavedLayout[]>(LAYOUTS_KEY);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && row.layout && Array.isArray(row.layout.items))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveLayout(
  name: string,
  layout: PageLayout,
  projectId?: string,
): Promise<SavedLayout[]> {
  const rows = await listLayouts();
  const trimmed = name.trim().slice(0, 24) || '未命名方案';
  const next: SavedLayout = {
    id: makeId(),
    name: trimmed,
    projectId,
    layout: normalize(layout),
    savedAt: Date.now(),
  };
  // 同名视为覆盖：用户改了同一套方案再存一次，不该出现两条一样的名字
  const kept = rows.filter((row) => row.name !== trimmed);
  const merged = [next, ...kept].slice(0, MAX_LAYOUTS);
  await KvRepository.set(LAYOUTS_KEY, merged);
  return merged;
}

export async function removeLayout(id: string): Promise<SavedLayout[]> {
  const rows = await listLayouts();
  const merged = rows.filter((row) => row.id !== id);
  await KvRepository.set(LAYOUTS_KEY, merged);
  return merged;
}

/** 给「保存为方案」用的默认名字：一眼看出这套版式是什么 */
export function suggestLayoutName(layout: PageLayout): string {
  const ids = new Set(layout.items.map((item) => item.id));
  if (!ids.has('image')) return '只有文字的一页';
  const bits: string[] = [];
  if (ids.has('index') || ids.has('title')) bits.push('带标题');
  if (ids.has('caption')) bits.push('带图注');
  if (ids.has('story')) bits.push('带正文');
  if (ids.has('score') || ids.has('advice')) bits.push('带点评');
  if (ids.has('params') || ids.has('exif')) bits.push('带参数');
  const size = layout.items.find((item) => item.id === 'image');
  const shape = size && size.colSpan >= 9 ? '大图' : '小图';
  return `${shape}${bits.length > 0 ? ' · ' + bits.slice(0, 2).join('') : ''}`;
}
