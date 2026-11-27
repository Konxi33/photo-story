// src/app/home/page.tsx
// 0.7.3「书桌」：首页从「刊头 + 扇形卡堆」改成一张真正的桌面。
//  - 第一行：继续上次（大卡）+ 两个动作卡（新建项目 / 打开成书）
//  - 第二行：四枚读数（项目 / 照片 / 已评分 / 平均分）
//  - 第三行：书架（项目封面网格，带完成度环）
//  - 第四行：模式带（8 个模块压成一排芯片，扫一眼就知道还有什么）
// 数据逻辑不变（ProjectRepository / PhotoRepository / AssetRepository），只换结构。
// 入场动画一律 --ps-delay 错峰；位移类动画走 backwards，避免把 fixed 变成包含块。

'use client';

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
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
  Package,
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
  selected: number;
  average: number | null;
  coverUrl: string | null;
  updatedAt: number;
}

const MAX_CARDS = 8;
/** 「继续上次」记在本地，项目页进入时写入；用存在性判断是否还活着 */
const LAST_PROJECT_KEY = 'ps:last-project';

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
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    try {
      setLastProjectId(window.localStorage.getItem(LAST_PROJECT_KEY));
    } catch {
      setLastProjectId(null);
    }
  }, []);

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
            selected: photos.filter((p) => p.selected).length,
            average,
            coverUrl,
            updatedAt: project.updatedAt ?? project.createdAt ?? 0,
          });
        }

        if (!cancelled) setCards(built);
      } catch {
        if (!cancelled) setCards([]);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
  }, []);

  const totals = useMemo(() => {
    const list = cards ?? [];
    const photos = list.reduce((sum, c) => sum + c.photoCount, 0);
    const scored = list.reduce((sum, c) => sum + c.scored, 0);
    const scoredAll = list.filter((c) => c.average !== null).map((c) => c.average as number);
    const average =
      scoredAll.length > 0
        ? Math.round((scoredAll.reduce((a, b) => a + b, 0) / scoredAll.length) * 10) / 10
        : null;
    return { projects: list.length, photos, scored, average };
  }, [cards]);

  /** 「继续上次」优先用记住的项目，否则退回最近更新的那个 */
  const resume = useMemo(() => {
    if (!cards || cards.length === 0) return null;
    const remembered = lastProjectId ? cards.find((c) => c.id === lastProjectId) : undefined;
    if (remembered) return remembered;
    return [...cards].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }, [cards, lastProjectId]);

  return (
    <AppShell showTopBar={false}>
      <div className="relative">
        {/* 桌面级背景：一层极淡的暖光，落在左上角，让留白不空 */}
        <div aria-hidden className="ps-desk-glow pointer-events-none" />

        <div className="relative mx-auto w-full max-w-[1180px] px-6 pt-9 pb-16 md:px-10">
          {/* ── 页眉：字标 + 导航 ───────────────────────────────── */}
          <header className="ps-enter flex items-center gap-3" style={{ '--ps-delay': '0ms' } as CSSProperties}>
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-ink text-[11px] font-semibold text-paper">
              照
            </span>
            <div className="min-w-0">
              <p className="ps-serif text-[15px] leading-none text-ink">照片故事</p>
              <p className="mt-1 text-[10px] tracking-[0.18em] text-ink-faint uppercase">
                Photo Story · v{APP_VERSION}
              </p>
            </div>
            <nav className="ml-auto flex items-center gap-1.5">
              <ThemeToggle />
              <Link href="/changelog" className="ps-chip h-8">
                更新日志
              </Link>
              <Link href="/settings" className="ps-chip h-8">
                设置
              </Link>
            </nav>
          </header>

          {/* ── 第一行：继续上次 + 两个动作 ─────────────────────── */}
          <section aria-label="继续上次" className="mt-9 grid gap-3 lg:grid-cols-[1.65fr_1fr]">
            <ResumeCard card={resume} loading={cards === null} />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <ActionTile
                href="/projects"
                icon={Plus}
                title="新建项目"
                hint="放入一次旅行的照片，起个名字"
                delay={90}
              />
              <ActionTile
                href="/book"
                icon={Package}
                title="打开成书"
                hint="编排章节，导出 Word / PDF"
                delay={150}
              />
            </div>
          </section>

          {/* ── 第二行：四枚读数 ───────────────────────────────── */}
          <dl className="ps-enter mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line/60 bg-line/40 sm:grid-cols-4">
            <StatCell label="项目" value={cards === null ? null : totals.projects} delay={0} />
            <StatCell label="照片" value={cards === null ? null : totals.photos} delay={40} />
            <StatCell label="已评分" value={cards === null ? null : totals.scored} delay={80} />
            <StatCell
              label="平均分"
              value={cards === null ? null : totals.average}
              suffix=""
              delay={120}
              decimal
            />
          </dl>

          {/* ── 第三行：书架 ───────────────────────────────────── */}
          <section aria-label="书架" className="mt-10">
            <div className="mb-3.5 flex items-end justify-between">
              <div>
                <p className="ps-cap">书架</p>
                <h2 className="ps-serif mt-1.5 text-[17px] text-ink">你的项目</h2>
              </div>
              <Link
                href={ROUTES.projects}
                className="group inline-flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-ink"
              >
                全部
                <ArrowUpRight className="ps-arrow h-3 w-3" />
              </Link>
            </div>

            {cards === null ? (
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="ps-skeleton h-[150px] rounded-[14px]" />
                ))}
              </ul>
            ) : cards.length === 0 ? (
              <Link
                href={ROUTES.projects}
                className="group flex flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-[var(--hairline)] py-14 text-[12px] text-ink-faint transition-colors duration-300 hover:border-copper/30 hover:text-ink"
              >
                <Camera className="h-5 w-5" strokeWidth={1.6} />
                还没有项目 —— 点这里把第一卷照片放进来
              </Link>
            ) : (
              <ul className="ps-reveal grid grid-cols-2 gap-3 md:grid-cols-4">
                {cards.map((card, index) => (
                  <li key={card.id} style={{ '--i': index } as CSSProperties}>
                    <ShelfCard card={card} />
                  </li>
                ))}
                {/* 0.8.0：项目不满一排时补一个「放入新的一卷」的虚线位，
                    否则一两个项目的书架右边空一大片，看着像加载失败 */}
                {cards.length < 4 ? (
                  <li>
                    <Link
                      href={ROUTES.projects}
                      className="group flex h-[150px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-[var(--hairline)] text-[12px] text-ink-faint transition-colors duration-300 hover:border-copper/30 hover:text-ink"
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.6} />
                      放入新的一卷
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          {/* ── 第四行：模式带 ─────────────────────────────────── */}
          <section aria-label="模式" className="mt-10">
            <div className="mb-3.5 flex items-end justify-between">
              <div>
                <p className="ps-cap">模式</p>
                <h2 className="ps-serif mt-1.5 text-[17px] text-ink">还能做这些</h2>
              </div>
              <p className="hidden text-[11px] text-ink-faint sm:block">
                挑照片 → 写文案 → 打分 → 编排 → 选片 → 导出
              </p>
            </div>

            <ul className="flex flex-wrap gap-1.5">
              {MODULES.filter((m) => m.id !== 'projects').map((item, index) => {
                const Icon = MODULE_ICONS[item.id] ?? LayoutGrid;
                return (
                  <li key={item.id} style={{ '--i': index } as CSSProperties}>
                    <Link
                      href={item.href}
                      title={item.tagline}
                      className="ps-chip group h-9 gap-2 px-3 text-[11.5px] hover:border-copper/40"
                    >
                      <Icon className="h-3.5 w-3.5 text-ink-faint transition-colors group-hover:text-copper" strokeWidth={1.7} />
                      {item.name}
                      <ArrowUpRight className="ps-arrow h-3 w-3 text-ink-faint/70" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <footer className="mt-12 flex items-center justify-between border-t border-line/50 pt-5 text-[10.5px] text-ink-faint">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-copper" />
              照片和文字都留在本机
            </span>
            <span className="tabular-nums">v{APP_VERSION}</span>
          </footer>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------- 继续上次 ------------------------------- */

function ResumeCard({ card, loading }: { card: Card | null; loading: boolean }) {
  if (loading) {
    return <div className="ps-skeleton h-[188px] rounded-[18px]" />;
  }
  if (!card) {
    return (
      <Link
        href={ROUTES.projects}
        className="ps-card ps-card-lift group flex min-h-[188px] flex-col justify-between bg-[var(--color-surface)] p-5"
      >
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          <Sparkles className="h-3.5 w-3.5 text-copper" />
          还没有项目
        </span>
        <span>
          <span className="ps-serif block text-[22px] leading-tight text-ink">
            把第一卷照片
            <br />
            放进来
          </span>
          <span className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-ink-mid">
            新建项目
            <ArrowRight className="ps-arrow h-3.5 w-3.5" />
          </span>
        </span>
      </Link>
    );
  }

  const ratio = card.photoCount > 0 ? card.scored / card.photoCount : 0;

  return (
    <Link
      href={ROUTES.project(card.id)}
      className="group relative flex min-h-[188px] overflow-hidden rounded-[18px] border border-line/60 bg-[var(--color-surface)] transition-[transform,box-shadow,border-color] duration-[380ms] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-ink/15 hover:shadow-[var(--elev-hover)]"
    >
      <span className="relative w-[46%] shrink-0 overflow-hidden bg-surface-3">
        {card.coverUrl ? (
          <FadeImg
            src={card.coverUrl}
            alt={card.name}
            className="h-full w-full object-cover transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover:scale-[1.04]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <Camera className="h-5 w-5 text-ink-faint/70" />
          </span>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-black/45 px-2 py-0.5 text-[10px] tracking-[0.12em] text-white/92 uppercase backdrop-blur-sm">
          继续上次
        </span>
      </span>

      <span className="flex min-w-0 flex-1 flex-col justify-between p-5">
        <span>
          <span className="block truncate text-[17px] font-medium tracking-[-0.01em] text-ink">
            {card.name}
          </span>
          <span className="mt-1.5 block text-[11.5px] text-ink-faint">
            {card.photoCount} 张 · 已评 {card.scored} · 已选 {card.selected}
          </span>
        </span>

        <span className="mt-4">
          <span className="flex items-baseline justify-between text-[10.5px] text-ink-faint">
            <span>评分进度</span>
            <span className="tabular-nums">{Math.round(ratio * 100)}%</span>
          </span>
          <span className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-ink/8">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-copper/70 to-copper"
              style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }}
            />
          </span>
          <span className="mt-4 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
            接着做
            <ArrowRight className="ps-arrow h-3.5 w-3.5" />
          </span>
        </span>
      </span>
    </Link>
  );
}

/* ------------------------------- 动作卡 ------------------------------- */

function ActionTile({
  href,
  icon: Icon,
  title,
  hint,
  delay,
}: {
  href: string;
  icon: typeof Plus;
  title: string;
  hint: string;
  delay: number;
}) {
  return (
    <Link
      href={href}
      className="ps-enter group ps-card ps-card-lift flex items-center gap-3 px-4 py-3.5"
      style={{ '--ps-delay': `${delay}ms` } as CSSProperties}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-surface-2 text-ink-mid transition-colors duration-300 group-hover:bg-copper/12 group-hover:text-copper">
        <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
          {title}
          <ArrowUpRight className="ps-arrow h-3 w-3 text-ink-faint" />
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">{hint}</span>
      </span>
    </Link>
  );
}

/* ------------------------------- 读数格 ------------------------------- */

function StatCell({
  label,
  value,
  delay,
  decimal = false,
  suffix = '',
}: {
  label: string;
  value: number | null;
  delay: number;
  decimal?: boolean;
  suffix?: string;
}) {
  return (
    <div
      className="ps-enter bg-[var(--color-surface)] px-4 py-3"
      style={{ '--ps-delay': `${delay}ms` } as CSSProperties}
    >
      <dt className="ps-cap">{label}</dt>
      <dd className="ps-stat mt-1.5 text-[22px] leading-none">
        {value === null ? (
          <span className="ps-skeleton inline-block h-5 w-9 align-middle" />
        ) : decimal ? (
          `${value.toFixed(1)}${suffix}`
        ) : (
          <>
            <CountUp value={value} />
            {suffix}
          </>
        )}
      </dd>
    </div>
  );
}

/* ------------------------------- 书架卡 ------------------------------- */

function ShelfCard({ card }: { card: Card }) {
  const ratio = card.photoCount > 0 ? card.scored / card.photoCount : 0;

  return (
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
        {/* 完成度：一条贴着底边的细线，比圆环更安静 */}
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-black/15">
          <span
            className="block h-full bg-copper"
            style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }}
          />
        </span>
      </span>

      <span className="block px-3.5 pt-2.5 pb-3">
        <span className="block truncate text-[12.5px] font-medium text-ink">{card.name}</span>
        <span className="mt-0.5 block text-[10.5px] tabular-nums text-ink-faint">
          {card.photoCount} 张 · {card.scored} 张已评
        </span>
      </span>
    </Link>
  );
}
