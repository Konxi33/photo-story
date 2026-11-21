// src/app/home/page.tsx
// 0.7.0「陶土 + 暗房」：首页整体重做。
//  - 左侧刊头（断笔标题 + 主行动 + 三项读数），右侧「最近项目」扇形卡片堆
//  - 中部是工作台地图（每一步管什么），底部是最近项目的横向轨道
//  - 所有入场错峰用 --ps-delay / ps-reveal，位移类动画一律 backwards，避免劫持 fixed
// 数据逻辑与 0.6.x 完全一致（ProjectRepository / PhotoRepository / AssetRepository），
// 只换皮与排版，不改取数路径。

'use client';

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  Camera,
  ChartLine,
  Compass,
  FlaskConical,
  Gauge,
  Gavel,
  Images,
  LayoutGrid,
  Plus,
  Sparkles,
  Swords,
} from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { CountUp } from '@/components/ui/count-up';
import { FadeImg } from '@/components/ui/fade-img';
import { APP_VERSION, ROUTES } from '@/config/app';
import { ThemeToggle } from '@/components/theme-toggle';
import { MODULES } from '@/config/modules';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { withTimeout } from '@/lib/utils';
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
  const totalScored = useMemo(
    () => (cards ?? []).reduce((sum, c) => sum + c.scored, 0),
    [cards],
  );

  /** 扇形卡片堆：取前三张有封面的项目 */
  const fanned = useMemo(() => (cards ?? []).filter((c) => c.coverUrl).slice(0, 3), [cards]);

  return (
    <AppShell showTopBar={false}>
      <div className="ps-stage relative min-h-[calc(100dvh-1px)] px-6 pt-8 pb-14 md:px-10 md:pt-10">
        {/* 环境光：陶土暖光 + 冷调补光，纯装饰 */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden">
          <div className="ps-hero-glow" />
        </div>

        {/* ── 顶部品牌行 ───────────────────────────────────────────── */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-ink text-paper shadow-[0_2px_10px_-4px_rgba(0,0,0,0.5)]">
              <Images className="h-[15px] w-[15px]" strokeWidth={1.7} />
              <span className="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full bg-copper ring-2 ring-[var(--color-paper)]" />
            </span>
            <span className="text-[13px] font-semibold tracking-[-0.01em]">照片故事</span>
            <span className="ps-chip ml-1 h-6 px-2 text-[10.5px] tabular-nums">v{APP_VERSION}</span>
          </div>

          <nav className="flex items-center gap-2 text-[11.5px]">
            {/* 0.7.1：首页也有一个外观开关，不用先钻进设置页 */}
            <ThemeToggle />
            <Link href="/changelog" className="ps-chip">
              更新日志
            </Link>
            <Link href="/settings" className="ps-chip">
              设置
            </Link>
          </nav>
        </header>

        {/* ── 英雄区：刊头 + 卡片堆 ─────────────────────────────────── */}
        <section className="grid items-center gap-12 pt-12 pb-16 lg:grid-cols-[1.12fr_0.88fr] lg:gap-16 lg:pt-16">
          <div className="min-w-0">
            <p className="ps-enter ps-cap flex items-center gap-2" style={{ '--ps-delay': '40ms' } as CSSProperties}>
              <Sparkles className="h-3 w-3 text-copper" strokeWidth={2} />
              Photo Story · 本地相册成书
            </p>

            {/* 断笔标题：整行保留 0.5.x 的「竖向切开」识别度，
                0.7.0 去掉了叠在后面的描边副本——两层字错开会显得脏。 */}
            <div
              className="ps-enter relative mt-5 w-fit select-none"
              style={{ '--ps-delay': '110ms' } as CSSProperties}
            >
              <h1
                className="ps-serif ps-display relative text-[46px] leading-[0.98] tracking-[0.06em] text-ink md:text-[76px]"
                style={{
                  WebkitMaskImage:
                    'repeating-linear-gradient(90deg, #000 0 7%, transparent 7% 10.5%)',
                  maskImage: 'repeating-linear-gradient(90deg, #000 0 7%, transparent 7% 10.5%)',
                }}
              >
                照片故事
              </h1>
              <span
                aria-hidden
                className="absolute -right-3 -bottom-2 h-[3px] w-16 rounded-full bg-gradient-to-r from-copper to-transparent md:-right-4 md:w-24"
              />
            </div>

            <p
              className="ps-enter mt-7 max-w-[30rem] text-[13.5px] leading-[1.75] text-ink-mid"
              style={{ '--ps-delay': '190ms' } as CSSProperties}
            >
              照片留在本地，文字由模型来写。把一次旅行、一段日子的照片放进来，
              排成可以直接打印的一册。
            </p>

            <div
              className="ps-enter mt-8 flex flex-wrap items-center gap-2.5"
              style={{ '--ps-delay': '250ms' } as CSSProperties}
            >
              <Link
                href={ROUTES.projects}
                className="ps-pressable ps-sheen group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[12.5px] font-medium text-primary-foreground shadow-[0_3px_12px_-5px_rgba(0,0,0,0.55)] transition-shadow duration-300 hover:shadow-[0_12px_28px_-14px_rgba(0,0,0,0.6)]"
              >
                进入项目
                <ArrowUpRight className="ps-arrow h-3.5 w-3.5" />
              </Link>
              <Link href="/gallery" className="ps-chip h-9 px-4 text-[12px]">
                <Images className="h-3.5 w-3.5" strokeWidth={1.7} />
                照片库
              </Link>
              <Link href="/score" className="ps-chip h-9 px-4 text-[12px]">
                <Gauge className="h-3.5 w-3.5" strokeWidth={1.7} />
                评分
              </Link>
            </div>

            {/* 三项读数 */}
            <dl
              className="ps-enter mt-10 flex flex-wrap items-end gap-x-10 gap-y-5"
              style={{ '--ps-delay': '320ms' } as CSSProperties}
            >
              <div>
                <dt className="ps-cap">项目</dt>
                <dd className="ps-stat mt-1.5 text-[26px]">
                  {cards === null ? <span className="ps-skeleton inline-block h-6 w-8" /> : cards.length}
                </dd>
              </div>
              <div className="h-9 w-px bg-[var(--hairline)]" />
              <div>
                <dt className="ps-cap">照片</dt>
                <dd className="ps-stat mt-1.5 text-[26px]">
                  {cards === null ? (
                    <span className="ps-skeleton inline-block h-6 w-12" />
                  ) : (
                    <CountUp value={totalPhotos} />
                  )}
                </dd>
              </div>
              <div className="h-9 w-px bg-[var(--hairline)]" />
              <div>
                <dt className="ps-cap">已评分</dt>
                <dd className="ps-stat mt-1.5 text-[26px]">
                  {cards === null ? (
                    <span className="ps-skeleton inline-block h-6 w-10" />
                  ) : (
                    <CountUp value={totalScored} />
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* 右侧：光圈环 + 最近三张封面扇形堆 */}
          <div
            className="ps-enter relative mx-auto h-[340px] w-full max-w-[420px] lg:h-[420px]"
            style={{ '--ps-delay': '220ms' } as CSSProperties}
          >
            <div aria-hidden className="ps-aperture absolute inset-x-0 top-1/2 mx-auto aspect-square w-[86%] -translate-y-1/2 opacity-70" />

            {fanned.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Link
                  href={ROUTES.projects}
                  className="ps-card ps-card-lift group flex w-[76%] flex-col items-center gap-3 px-6 py-10 text-center"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink-mid">
                    <Camera className="h-5 w-5" strokeWidth={1.6} />
                  </span>
                  <span className="text-[13px] font-medium text-ink">还没有项目</span>
                  <span className="text-[11.5px] leading-relaxed text-ink-faint">
                    新建一个项目，把照片放进来自动成册
                  </span>
                  <span className="ps-chip mt-1 border-copper/30 text-copper">
                    <Plus className="h-3 w-3" />
                    新建项目
                  </span>
                </Link>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                {fanned.map((card, index) => {
                  const center = (fanned.length - 1) / 2;
                  const offset = index - center;
                  return (
                    <Link
                      key={card.id}
                      href={ROUTES.project(card.id)}
                      className="ps-pressable absolute w-[62%] overflow-hidden rounded-[18px] border border-white/60 bg-surface shadow-[0_24px_60px_-30px_rgba(20,19,26,0.45),0_2px_6px_-2px_rgba(20,19,26,0.15)] transition-[transform,box-shadow] duration-[520ms] ease-[var(--ease-spring)] hover:z-30 hover:!translate-y-[-14px] hover:shadow-[0_32px_80px_-32px_rgba(20,19,26,0.55)]"
                      style={{
                        transform: `translateX(${offset * 34}%) translateY(${Math.abs(offset) * 10}px) rotate(${offset * 6}deg)`,
                        zIndex: 10 - Math.abs(index - center) * 1,
                        aspectRatio: '4 / 3',
                      }}
                    >
                      {card.coverUrl ? (
                        <FadeImg
                          src={card.coverUrl}
                          alt={card.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-surface-2">
                          <Images className="h-5 w-5 text-ink-faint/70" />
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/62 via-black/24 to-transparent px-3 pt-8 pb-2.5">
                        <span className="truncate text-[11.5px] font-medium text-white/95">
                          {card.name}
                        </span>
                        <span className="shrink-0 text-[10.5px] tabular-nums text-white/72">
                          {card.photoCount} 张
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── 工作台地图 ───────────────────────────────────────────── */}
        <section aria-label="工作台地图" className="pb-14">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="ps-cap">工作台 · 每一步管什么</p>
              <h2 className="ps-display mt-2 text-[19px] text-ink">
                挑照片 → 写文案 → 打分 → 编排 → 选片 → 导出
              </h2>
            </div>
            <Link href={ROUTES.projects} className="ps-chip">
              全部模块
              <ArrowUpRight className="ps-arrow h-3 w-3" />
            </Link>
          </div>

          <ul className="ps-reveal grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.filter((m) => m.id !== 'projects').map((item, index) => {
              const Icon = MODULE_ICONS[item.id] ?? LayoutGrid;
              return (
                <li key={item.id} style={{ '--i': index } as CSSProperties}>
                  <Link
                    href={item.href}
                    className="group ps-card ps-card-lift flex h-full items-start gap-3 px-4 py-3.5"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-ink-mid transition-colors duration-300 group-hover:bg-copper/12 group-hover:text-copper">
                      <Icon className="h-[15px] w-[15px]" strokeWidth={1.7} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-medium text-ink">{item.name}</span>
                        <ArrowUpRight className="ps-arrow h-3 w-3 text-ink-faint" />
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-ink-faint">
                        {item.tagline}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── 最近项目：横向轨道 ───────────────────────────────────── */}
        <section aria-label="最近项目">
          <div className="mb-4 flex items-end justify-between">
            <p className="ps-cap">最近项目</p>
            <Link
              href={ROUTES.projects}
              className="group inline-flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-ink"
            >
              全部
              <ArrowUpRight className="ps-arrow h-3 w-3" />
            </Link>
          </div>

          {cards === null ? (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="ps-skeleton h-[132px] rounded-[16px]" />
              ))}
            </ul>
          ) : cards.length === 0 ? (
            <Link
              href={ROUTES.projects}
              className="group flex items-center justify-center gap-2 rounded-[16px] border border-dashed border-[var(--hairline)] py-12 text-[12px] text-ink-faint transition-colors duration-300 hover:border-copper/30 hover:text-ink"
            >
              <Plus className="h-3.5 w-3.5 transition-transform duration-300 group-hover:rotate-90" />
              还没有项目，点这里新建
            </Link>
          ) : (
            <ul className="ps-reveal grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {cards.map((card, index) => (
                <li key={card.id} style={{ '--i': index } as CSSProperties}>
                  <Link
                    href={ROUTES.project(card.id)}
                    className="group ps-card ps-card-lift block overflow-hidden"
                  >
                    <span className="relative block aspect-[16/10] overflow-hidden bg-surface-3">
                      {card.coverUrl ? (
                        <FadeImg
                          src={card.coverUrl}
                          alt={card.name}
                          className="h-full w-full object-cover transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover:scale-[1.05]"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <Images className="h-4 w-4 text-ink-faint/70" />
                        </span>
                      )}
                      <span className="absolute top-2 right-2 rounded-full bg-black/42 px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-white/92 backdrop-blur-sm">
                        {card.average === null ? '—' : card.average.toFixed(1)}
                      </span>
                    </span>

                    <span className="block px-3.5 pt-2.5 pb-3">
                      <span className="block truncate text-[12.5px] font-medium text-ink">
                        {card.name}
                      </span>
                      <span className="mt-0.5 block text-[10.5px] tabular-nums text-ink-faint">
                        {card.photoCount} 张 · {card.scored} 张已评
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
