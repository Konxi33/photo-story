// src/app/changelog/page.tsx
// 更新日志：按版本折叠 + 按类型分组 + 类型筛选。
// 0.5.3：之前所有版本的所有条目一次性铺开，一屏几十行小字看不下去。
// 现在默认只展开当前版本，历史版本收成一行摘要（版本号 · 日期 · 标题 · 三类条数），
// 点开才展开；顶部的筛选可以把「新增 / 优化 / 修复」单独拎出来看。

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bug, ChevronDown, Sparkles, Wand2 } from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { APP_VERSION } from '@/config/app';
import { CHANGELOGS } from '@/config/changelogs';
import {
  CHANGELOG_KINDS,
  classifyItems,
  countKinds,
  type ChangelogKind,
} from '@/lib/changelog';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<ChangelogKind, typeof Sparkles> = {
  new: Sparkles,
  polish: Wand2,
  fix: Bug,
};

const KIND_TONE: Record<ChangelogKind, string> = {
  new: 'text-emerald-600 dark:text-emerald-400',
  polish: 'text-sky-600 dark:text-sky-400',
  fix: 'text-amber-600 dark:text-amber-400',
};

const KIND_CHIP: Record<ChangelogKind, string> = {
  new: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  polish: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  fix: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

type Filter = 'all' | ChangelogKind;

/**
 * 0.6.1：把一条更新拆成「粗体提要 + 细说」。
 * 原来每条都是一整行小字，一屏看过去全是字，抓不到重点。
 * 规则：优先用「：」切；没有就用第一个逗号；都没有就取前 12 个字当提要。
 */
function splitItem(text: string): { lead: string; sep: string; rest: string } {
  const colon = text.indexOf('：');
  if (colon > 0 && colon <= 18)
    return { lead: text.slice(0, colon), sep: '：', rest: text.slice(colon + 1).trim() };
  const sep = text.indexOf('，');
  if (sep > 0 && sep <= 14)
    return { lead: text.slice(0, sep), sep: '，', rest: text.slice(sep + 1).trim() };
  if (text.length <= 14) return { lead: text, sep: '', rest: '' };
  return { lead: text.slice(0, 12), sep: '…', rest: text.slice(12) };
}

const KIND_WEIGHT: Record<ChangelogKind, number> = { new: 0, fix: 1, polish: 2 };

/** 挑出最多 3 条「这一版最值得知道的」，优先新增、其次修复、最后优化 */
function pickHighlights<T extends { kind: ChangelogKind }>(items: T[], max = 3): T[] {
  return [...items]
    .sort((a, b) => KIND_WEIGHT[a.kind] - KIND_WEIGHT[b.kind])
    .slice(0, max);
}

export default function ChangelogPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<string>>(() => new Set([APP_VERSION]));

  const versions = useMemo(
    () =>
      CHANGELOGS.map((entry) => {
        const metas = classifyItems(entry.items);
        return { entry, metas, counts: countKinds(metas) };
      }),
    [],
  );

  const totals = useMemo(() => {
    const acc: Record<ChangelogKind, number> = { new: 0, polish: 0, fix: 0 };
    for (const v of versions) for (const m of v.metas) acc[m.kind] += 1;
    return acc;
  }, [versions]);

  const totalItems = totals.new + totals.polish + totals.fix;

  // 切到某个类型时，把所有含该类型的版本展开，省得用户一个个点
  useEffect(() => {
    if (filter === 'all') return;
    setOpen(new Set(versions.filter((v) => v.metas.some((m) => m.kind === filter)).map((v) => v.entry.version)));
  }, [filter, versions]);

  const toggle = (version: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  const allOpen = versions.every((v) => open.has(v.entry.version));

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: totalItems },
    ...CHANGELOG_KINDS.map((k) => ({ id: k.id as Filter, label: k.label, count: totals[k.id] })),
  ];

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl px-5 py-9 md:px-8">
        <header className="mb-6">
          <p className="ps-eyebrow">Changelog</p>
          <h1 className="ps-display mt-2 text-[26px] text-ink">更新日志</h1>
          <p className="mt-2 text-[13px] text-ink-mid">
            当前版本 v{APP_VERSION} · 共 {versions.length} 个版本、{totalItems} 条改动
          </p>
        </header>

        {/* 筛选 + 全展开 */}
        <div className="ps-edge-fade ps-no-scrollbar sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-1.5 overflow-x-auto px-1 py-2 backdrop-blur-sm">
          {chips.map((chip) => {
            const active = filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilter(chip.id)}
                aria-pressed={active}
                className={cn(
                  'ps-pressable shrink-0 rounded-full border px-3 py-1.5 text-[12px] whitespace-nowrap transition-all duration-[240ms] ease-[var(--ease-out)]',
                  active
                    ? 'border-ink/15 bg-ink text-paper shadow-[0_1px_3px_rgba(0,0,0,0.18)]'
                    : 'border-line/60 bg-surface-2/60 text-ink-mid hover:border-ink/20 hover:bg-surface hover:text-ink',
                )}
              >
                {chip.label}
                <span className={cn('ml-1 tabular-nums', active ? 'opacity-70' : 'opacity-50')}>
                  {chip.count}
                </span>
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px shrink-0 bg-line/70" />
          <button
            type="button"
            onClick={() =>
              setOpen(allOpen ? new Set() : new Set(versions.map((v) => v.entry.version)))
            }
            className="ps-pressable shrink-0 rounded-full px-3 py-1.5 text-[12px] whitespace-nowrap text-ink-faint transition-colors hover:bg-surface-2/70 hover:text-ink"
          >
            {allOpen ? '全部收起' : '全部展开'}
          </button>
        </div>

        {/* 版本列表 */}
        <div className="relative mt-3 pl-6">
          <span
            aria-hidden
            className="absolute top-3 bottom-3 left-[5px] w-px bg-gradient-to-b from-line via-line/70 to-transparent"
          />

          {versions.map(({ entry, metas, counts }, index) => {
            const current = entry.version === APP_VERSION;
            const isOpen = open.has(entry.version);
            const shown = filter === 'all' ? metas : metas.filter((m) => m.kind === filter);
            const dimmed = filter !== 'all' && shown.length === 0;
            // 每版挑 3 条当「亮点」，剩下的按类型列在下面（亮点不重复出现）
            const hl = filter === 'all' ? pickHighlights(shown) : [];

            return (
              <article
                key={entry.version}
                id={'v-' + entry.version.replace(/\./g, '-')}
                data-version={entry.version}
                className="ps-enter relative scroll-mt-24 pb-2"
                style={{ ['--ps-delay' as string]: `${Math.min(index, 8) * 45}ms` }}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-[13px] -left-6 h-[11px] w-[11px] rounded-full border-2 transition-colors',
                    current
                      ? 'border-ink bg-ink shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-ink)_10%,transparent)]'
                      : 'border-line bg-paper',
                  )}
                />

                <button
                  type="button"
                  onClick={() => toggle(entry.version)}
                  aria-expanded={isOpen}
                  className={cn(
                    'ps-pressable group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-[220ms]',
                    isOpen
                      ? 'border-line/70 bg-surface-2/50'
                      : 'border-transparent hover:border-line/60 hover:bg-surface-2/40',
                    dimmed && 'opacity-45',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={cn(
                          'text-[14px] font-semibold tracking-[-0.01em]',
                          current ? 'text-ink' : 'text-ink-mid group-hover:text-ink',
                        )}
                      >
                        v{entry.version}
                      </span>
                      {current && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ink px-1.5 py-0.5 text-[9px] leading-none text-paper">
                          当前
                        </span>
                      )}
                      <span className="text-[11px] text-ink-faint tabular-nums">{entry.date}</span>
                      <span className="truncate text-[11.5px] text-ink-faint">{entry.title}</span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {counts.map(({ kind, count }) => {
                        const Icon = KIND_ICON[kind];
                        const label = CHANGELOG_KINDS.find((k) => k.id === kind)?.label ?? '';
                        return (
                          <span
                            key={kind}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                              KIND_CHIP[kind],
                            )}
                          >
                            <Icon className="h-2.5 w-2.5" />
                            {label}
                            <span className="tabular-nums opacity-70">{count}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-ink-faint transition-transform duration-[260ms] ease-[var(--ease-out)]',
                      isOpen && 'rotate-180',
                    )}
                  />
                </button>

                {/* 折叠区：grid-rows 0fr ↔ 1fr，高度自适应且能过渡 */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-[300ms] ease-[var(--ease-out)]',
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="grid gap-3 pt-2 pb-3">
                      {hl.length > 0 && (
                        <div className="grid gap-2 sm:grid-cols-3">
                          {hl.map((item) => {
                            const Icon = KIND_ICON[item.kind];
                            const { lead, rest } = splitItem(item.text);
                            return (
                              <div
                                key={item.kind + lead}
                                className="group rounded-xl border border-line/50 bg-surface-2/50 p-3 transition-all duration-[220ms] hover:-translate-y-0.5 hover:border-line hover:shadow-[0_10px_26px_-18px_rgba(0,0,0,0.5)]"
                              >
                                <div className="flex items-center gap-1.5">
                                  <Icon className={cn('h-3.5 w-3.5', KIND_TONE[item.kind])} />
                                  <span className={cn('text-[10px] leading-none', KIND_TONE[item.kind])}>
                                    {CHANGELOG_KINDS.find((k) => k.id === item.kind)?.label}
                                  </span>
                                </div>
                                <p className="mt-1.5 text-[13px] leading-[1.5] font-semibold tracking-[-0.01em] text-ink">
                                  {lead}
                                </p>
                                {rest && (
                                  <p className="mt-1 line-clamp-3 text-[11.5px] leading-[1.6] text-ink-faint">
                                    {rest}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {CHANGELOG_KINDS.map((kind) => {
                        const list = shown.filter(
                          (m) => m.kind === kind.id && !hl.some((h) => h === m),
                        );
                        if (list.length === 0) return null;
                        const Icon = KIND_ICON[kind.id];
                        return (
                          <section key={kind.id}>
                            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.02em]">
                              <Icon className={cn('h-3 w-3', KIND_TONE[kind.id])} />
                              <span className={KIND_TONE[kind.id]}>{kind.label}</span>
                              <span className="text-ink-faint">· {kind.hint}</span>
                              <span className="text-ink-faint tabular-nums">{list.length}</span>
                            </h3>
                            <ul className="grid gap-1">
                              {list.map((item, i) => {
                                const { lead, sep, rest } = splitItem(item.text);
                                return (
                                  <li
                                    key={kind.id + i}
                                    className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2/50"
                                  >
                                    <span className="mt-[9px] h-[3px] w-[3px] shrink-0 rounded-full bg-ink-faint/70" />
                                    <p className="min-w-0 text-[12.5px] leading-[1.7] text-ink-mid">
                                      <span className="font-medium text-ink">{lead}</span>
                                      {sep && <span className="text-ink-faint">{sep}</span>}
                                      {rest}
                                    </p>
                                  </li>
                                );
                              })}
                            </ul>
                          </section>
                        );
                      })}
                      {shown.length === 0 && (
                        <p className="text-[12px] text-ink-faint">这个版本没有这一类改动。</p>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-6 border-t border-line/50 pt-4 text-center text-[11px] text-ink-faint">
          更早的 0.2.x 版本记录已归档，如需查看可打开安装目录里的旧版更新日志。
        </p>
      </div>
    </AppShell>
  );
}