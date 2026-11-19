// src/app/home/page.tsx
// 主菜单：点左上角「照片故事」进入。
// 0.5.1：杂志封面式双栏版式——左侧刊头（缺笔字标题 + 说明 + 入口），
// 右侧「最近项目」竖排清单，进场按 刊头 → 说明 → 清单 的顺序错峰浮现。
// 相比之前的单栏居中版，宽屏下不再有大片空白，只有一个项目时也不会左右失衡。

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  ChartLine,
  Compass,
  FlaskConical,
  Gauge,
  Gavel,
  Images,
  LayoutGrid,
  Plus,
  Swords,
} from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { CountUp } from '@/components/ui/count-up';
import { FadeImg } from '@/components/ui/fade-img';
import { APP_VERSION, ROUTES } from '@/config/app';
import { MODULES } from '@/config/modules';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { cn, withTimeout } from '@/lib/utils';
import type { Photo, ProjectSummary } from '@/types/domain';

interface Card {
  id: string;
  name: string;
  photoCount: number;
  scored: number;
  average: number | null;
  coverUrl: string | null;
}

const MAX_CARDS = 6;

/** 主页功能地图用的图标（与侧栏保持同一套视觉语言） */
const MODULE_ICONS: Record<string, typeof LayoutGrid> = {
  gallery: Images,
  score: Gauge,
  book: BookOpen,
  lab: FlaskConical,
  themes: Compass,
  compare: Swords,
  review: Gavel,
  growth: ChartLine,
};

export default function HomePage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    urlsRef.current = urls;

    void (async () => {
      try {
        const projects: ProjectSummary[] = await withTimeout(ProjectRepository.list(), 5000, []);
        const picked = projects.slice(0, MAX_CARDS);
        const built: Card[] = [];

        for (const project of picked) {
          const photos: Photo[] = await withTimeout(
            PhotoRepository.listByProject(project.id),
            4000,
            [],
          );
          const scored = photos
            .map((p) => p.analysis?.score?.overall)
            .filter((v): v is number => typeof v === 'number');
          const average =
            scored.length > 0
              ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
              : null;

          let coverUrl: string | null = null;
          const cover = project.coverPhotoId ?? photos[0]?.id;
          if (cover) {
            try {
              const asset = await AssetRepository.get(cover, 'preview');
              if (asset) {
                coverUrl = URL.createObjectURL(asset.blob);
                urls.push(coverUrl);
              }
            } catch {
              coverUrl = null;
            }
          }

          built.push({
            id: project.id,
            name: project.name,
            photoCount: project.photoCount,
            scored: scored.length,
            average,
            coverUrl,
          });
        }

        if (!cancelled) setCards(built);
      } catch {
        if (!cancelled) setCards([]);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const totalPhotos = useMemo(
    () => (cards ?? []).reduce((sum, c) => sum + c.photoCount, 0),
    [cards],
  );

  return (
    <AppShell showTopBar={false}>
      <div className="relative flex min-h-[calc(100dvh-1px)] flex-col px-7 pt-10 pb-10 md:px-12 md:pt-12">
        {/* 顶部：品牌行 */}
        <header className="flex items-center justify-between">
          <div
            className="ps-enter flex items-center gap-2.5"
            style={{ ['--ps-delay' as string]: '0ms' }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-ink text-paper shadow-[0_2px_10px_-4px_rgba(0,0,0,0.5)]">
              <Images className="h-[15px] w-[15px]" strokeWidth={1.7} />
            </span>
            <span className="text-[13px] font-semibold tracking-[-0.01em]">照片故事</span>
          </div>

          <div
            className="ps-enter flex items-center gap-5 text-[11px] text-ink-faint"
            style={{ ['--ps-delay' as string]: '60ms' }}
          >
            <span className="hidden sm:inline tabular-nums">v{APP_VERSION}</span>
            <Link href="/changelog" className="transition-colors duration-200 hover:text-ink">
              更新日志
            </Link>
            <Link href="/settings" className="transition-colors duration-200 hover:text-ink">
              设置
            </Link>
          </div>
        </header>

        {/* 主体：左刊头 + 右清单 */}
        <div className="grid flex-1 items-center gap-10 py-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.86fr)] xl:gap-16 xl:py-0">
          {/* 刊头 */}
          <div className="min-w-0">
            <p className="ps-enter ps-eyebrow" style={{ ['--ps-delay' as string]: '120ms' }}>
              Photo Story · 本地相册成书
            </p>

            {/* 残缺字：轮廓完整、笔画被竖向切开，形成「断裂但仍可读」的标题 */}
            <div
              className="ps-enter relative mt-4 w-fit select-none"
              style={{ ['--ps-delay' as string]: '180ms' }}
            >
              <span
                aria-hidden
                className="ps-serif absolute inset-0 text-[52px] leading-[0.98] font-semibold tracking-[0.1em] text-ink/12 md:text-[86px]"
                style={{ WebkitTextStroke: '1px currentColor' }}
              >
                照片故事
              </span>
              <h1
                className="ps-serif relative text-[52px] leading-[0.98] font-semibold tracking-[0.1em] text-ink md:text-[86px]"
                style={{
                  WebkitMaskImage:
                    'repeating-linear-gradient(90deg, #000 0 7%, transparent 7% 10.5%)',
                  maskImage: 'repeating-linear-gradient(90deg, #000 0 7%, transparent 7% 10.5%)',
                }}
              >
                照片故事
              </h1>
            </div>

            <p
              className="ps-enter mt-6 max-w-[30rem] text-[13.5px] leading-relaxed text-ink-mid"
              style={{ ['--ps-delay' as string]: '260ms' }}
            >
              照片留在本地，文字由模型来写。把一次旅行、一段日子的照片放进来，排成可以直接打印的一册。
            </p>

            <div
              className="ps-enter mt-8 flex flex-wrap items-center gap-2.5"
              style={{ ['--ps-delay' as string]: '330ms' }}
            >
              <Link
                href={ROUTES.projects}
                className="ps-pressable group inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[12.5px] font-medium text-paper shadow-[0_2px_10px_-4px_rgba(0,0,0,0.55)] transition-shadow duration-300 hover:shadow-[0_10px_26px_-12px_rgba(0,0,0,0.6)]"
              >
                进入项目
                <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
              <Link
                href="/gallery"
                className="ps-pressable rounded-full border border-line/80 bg-surface/50 px-5 py-2.5 text-[12.5px] text-ink-mid backdrop-blur-sm transition-colors duration-200 hover:border-ink/20 hover:text-ink"
              >
                照片库
              </Link>
              <Link
                href="/score"
                className="ps-pressable rounded-full border border-line/80 bg-surface/50 px-5 py-2.5 text-[12.5px] text-ink-mid backdrop-blur-sm transition-colors duration-200 hover:border-ink/20 hover:text-ink"
              >
                评分
              </Link>
            </div>

            {totalPhotos > 0 && (
              <p
                className="ps-enter mt-6 flex items-center gap-1.5 text-[11.5px] text-ink-faint"
                style={{ ['--ps-delay' as string]: '390ms' }}
              >
                共 <CountUp value={totalPhotos} className="tabular-nums" /> 张照片
                {cards && cards.length > 0 && (
                  <span className="text-ink-faint/60">· {cards.length} 个项目</span>
                )}
              </p>
            )}
          </div>

          {/* 最近项目：竖排清单 */}
          <section className="min-w-0">
            <div
              className="ps-enter mb-3 flex items-end justify-between"
              style={{ ['--ps-delay' as string]: '360ms' }}
            >
              <p className="ps-eyebrow">最近项目</p>
              <Link
                href={ROUTES.projects}
                className="group inline-flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-ink"
              >
                全部
                <ArrowUpRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>

            {cards === null ? (
              <div className="grid gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="ps-skeleton h-[76px] rounded-xl" />
                ))}
              </div>
            ) : cards.length === 0 ? (
              <Link
                href={ROUTES.projects}
                className="group flex items-center justify-center gap-2 rounded-xl border border-dashed border-line/80 py-10 text-[12px] text-ink-faint transition-colors duration-300 hover:border-ink/25 hover:text-ink"
              >
                <Plus className="h-3.5 w-3.5 transition-transform duration-300 group-hover:rotate-90" />
                还没有项目，点这里新建
              </Link>
            ) : (
              <ul className="grid gap-2">
                {cards.map((card, index) => (
                  <li
                    key={card.id}
                    className="ps-enter"
                    style={{ ['--ps-delay' as string]: `${420 + index * 55}ms` }}
                  >
                    <Link
                      href={ROUTES.project(card.id)}
                      className="ps-pressable group flex items-center gap-3 rounded-xl border border-line/50 bg-surface-2/40 p-2 transition-colors duration-300 hover:border-ink/15 hover:bg-surface-2/70"
                    >
                      <span className="relative h-[60px] w-[78px] shrink-0 overflow-hidden rounded-lg bg-surface-3">
                        {card.coverUrl ? (
                          <FadeImg
                            src={card.coverUrl}
                            alt={card.name}
                            className="h-full w-full object-cover transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover:scale-[1.06]"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center">
                            <Images className="h-4 w-4 text-ink-faint/70" />
                          </span>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-ink">
                          {card.name}
                        </span>
                        <span className="mt-0.5 block text-[10.5px] text-ink-faint tabular-nums">
                          {card.photoCount} 张 · {card.scored} 张已评
                        </span>
                      </span>

                      <span
                        className={cn(
                          'shrink-0 pr-1 text-[13px] font-semibold tabular-nums',
                          card.average === null ? 'text-ink-faint/50' : 'text-ink',
                        )}
                      >
                        {card.average === null ? '—' : card.average.toFixed(1)}
                      </span>

                      <ArrowUpRight className="mr-1 h-3.5 w-3.5 shrink-0 text-ink-faint/0 transition-all duration-300 ease-[var(--ease-spring)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* 工作台一览：0.5.5 新增 —— 回答「这些大功能到底是干什么用的」。
            每个模块一句话说清用途，点进去还能看到三步上手。 */}
        <section className="mt-4 border-t border-line/40 pt-6" aria-label="工作台一览">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="ps-eyebrow">工作台 · 每一步管什么</p>
            <p className="text-[11px] text-ink-faint">挑照片 → 写文案 → 打分 → 编排 → 选片 → 导出</p>
          </div>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {MODULES.filter((m) => m.id !== 'projects').map((item, index) => {
              const Icon = MODULE_ICONS[item.id] ?? LayoutGrid;
              return (
                <li
                  key={item.id}
                  className="ps-enter"
                  style={{ ['--ps-delay' as string]: `${440 + index * 40}ms` }}
                >
                  <Link
                    href={item.href}
                    className="ps-pressable group flex h-full items-center gap-2.5 rounded-xl border border-line/50 bg-surface-2/35 px-3 py-2 transition-[border-color,background-color,transform] duration-300 hover:-translate-y-[2px] hover:border-ink/15 hover:bg-surface-2/70"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3/70 text-ink-mid transition-colors duration-300 group-hover:text-ink">
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-ink">{item.name}</span>
                      <span className="block truncate text-[10.5px] leading-snug text-ink-faint">
                        {item.tagline}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
