// src/lib/export/presets.ts
// 0.5.6：导出预设——把一整套排版选项存成方案，下次一键套用。
// 存在 kv 里（`ps:export-presets`），不跟项目绑定，换项目也能用。

'use client';

import { KvRepository } from '@/lib/db';
import type { ExportSettings } from '@/types/domain';

const PRESET_KEY = 'ps:export-presets';

export interface ExportPreset {
  id: string;
  name: string;
  settings: ExportSettings;
  savedAt: number;
}

function makeId(): string {
  return 'preset-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export async function listPresets(): Promise<ExportPreset[]> {
  try {
    const rows = await KvRepository.get<ExportPreset[]>(PRESET_KEY);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && typeof row.name === 'string' && row.settings)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function savePreset(name: string, settings: ExportSettings): Promise<ExportPreset[]> {
  const clean = name.trim().slice(0, 24) || '未命名方案';
  const rows = await listPresets();
  const next: ExportPreset[] = [
    { id: makeId(), name: clean, settings, savedAt: Date.now() },
    // 同名覆盖，避免列表里一堆「A4 双栏」
    ...rows.filter((row) => row.name !== clean),
  ].slice(0, 12);
  await KvRepository.set(PRESET_KEY, next);
  return next;
}

export async function removePreset(id: string): Promise<ExportPreset[]> {
  const rows = await listPresets();
  const next = rows.filter((row) => row.id !== id);
  await KvRepository.set(PRESET_KEY, next);
  return next;
}
