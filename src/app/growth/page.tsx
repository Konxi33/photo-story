// src/app/growth/page.tsx
// 0.5.2 新模块：摄影档案。
// 跨项目把「你拍了什么、什么时候拍、用什么拍、拍得怎么样」摊开来看，
// 全部基于本地数据与 EXIF，不联网。

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Aperture, Camera, ChartLine, Clock3, Loader2, Mountain, Sparkles } from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { ModuleGuide } from '@/components/module-guide';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/config/app';
import {
  buildArchiveStats,
  formatHour,
  hourSegment,
  type ArchiveStats,
  type Bucket,
  type MonthPoint,
} from '@/lib/archive/stats';
import { PhotoRepository, ProjectRepository } from '@/lib/db';
import { cn, withTimeout } from '@/lib/utils';
import type { Photo, ProjectSummary } from '@/types/domain';

export default function GrowthPage() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, projectList] = await Promise.all([
          withTimeout(PhotoRepository.listAll(), 6000, [] as Photo[]),
          withTimeout(ProjectRepository.list(), 6000, [] as ProjectSummary[]),
        ]);
        if (cancelled) return;
        setPhotos(list);
        setProjects(projectList);
      } catch {
        if (!cancelled) {
          setError('读取本地数据失败');
          setPhotos([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => (photos ? buildArchiveStats(photos, 12) : null), [photos]);

  const summary = useMemo(() => (stats ? buildSummary(stats) : null), [stats]);

  return (
    <AppShell>
      <div className="px-5 py-8 md:px-8">
        <header className="mb-6">
          <p className="ps-eyebrow">Archive</p>
          <h1 className="ps-display mt-2 text-[26px] text-ink">摄影档案</h1>
          <p className="mt-2 max-w-[42rem] text-[13px] leading-relaxed text-ink-mid">
            所有项目里的照片都汇总在这里：拍得多不多、什么时候拍、用什么器材、分数怎么走。用来回看自己的习惯。
          </p>
        </header>

        {/* 0.5.5：第一次进来先告诉用户这个模块是干什么用的 */}
        <ModuleGuide moduleId="growth" className="mb-5" />

        {photos === null ? (
          <div className="flex items-center gap-2 py-20 text-[13px] text-ink-faint">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在统计…
          </div>
        ) : error ? (
          <Hint title={error} hint="刷新页面再试一次。" />
        ) : !stats || stats.total === 0 ? (
          <div className="rounded-[16px] border border-dashed border-line/80 bg-surface-2/30 px-6 py-20 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2">
              <ChartLine className="h-5 w-5 text-ink-faint" strokeWidth={1.4} />
            </span>
            <p className="text-[15px] font-medium text-ink">还没有照片可以统计</p>
            <p className="mt-1.5 text-[12.5px] text-ink-faint">
              先建一个项目、导入照片，档案会自动长出来。
            </p>
            <Link href={ROUTES.projects}>
              <Button size="sm" className="mt-5 h-8 rounded-full px-4">
                去建项目
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {/* KPI */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="照片总数" value={String(stats.total)} unit="张" hint={`${projects.length} 个项目`} />
              <Kpi
                label="平均分"
                value={stats.avgScore === null ? '—' : stats.avgScore.toFixed(1)}
                unit={stats.avgScore === null ? '' : '分'}
                hint={stats.scored > 0 ? `${stats.scored} 张已评` : '还没有评分'}
              />
              <Kpi
                label="拍摄天数"
                value={String(stats.shootingDays)}
                unit="天"
                hint={
                  stats.firstShot && stats.lastShot
                    ? `${formatDate(stats.firstShot)} 起`
                    : '缺拍摄时间'
                }
              />
              <Kpi
                label="最常拍的时段"
                value={stats.busiestHour === null ? '—' : formatHour(stats.busiestHour)}
                unit=""
                hint={stats.busiestHour === null ? '缺拍摄时间' : hourSegment(stats.busiestHour)}
              />
            </div>

            {/* 一句话总结 */}
            {summary && (
              <section className="ps-card flex items-start gap-3 rounded-[14px] border border-line/60 bg-surface/60 px-4 py-3.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  <Sparkles className="h-3.5 w-3.5 text-ink-mid" strokeWidth={1.6} />
                </span>
                <p className="text-[12.8px] leading-relaxed text-ink-mid">{summary}</p>
              </section>
            )}

            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              {/* 评分趋势 */}
              <Panel
                title="评分趋势"
                hint={stats.scored > 0 ? '近 12 个月的平均分' : '还没有评分数据'}
                icon={<ChartLine className="h-3.5 w-3.5" strokeWidth={1.7} />}
              >
                {stats.scored === 0 ? (
                  <EmptyLine text="去评分，趋势才会出现" />
                ) : (
                  <TrendChart points={stats.months} />
                )}
              </Panel>

              {/* 时段分布 */}
              <Panel
                title="你什么时候按快门"
                hint={stats.busiestHour === null ? '缺拍摄时间' : `高峰 ${formatHour(stats.busiestHour)}`}
                icon={<Clock3 className="h-3.5 w-3.5" strokeWidth={1.7} />}
              >
                <HourHeat hours={stats.hours} busiest={stats.busiestHour} />
              </Panel>

              {/* 拍摄量 */}
              <Panel
                title="每月拍摄量"
                hint="近 12 个月"
                icon={<Mountain className="h-3.5 w-3.5" strokeWidth={1.7} />}
              >
                <VolumeBars points={stats.months} />
              </Panel>

              {/* 题材 */}
              <Panel title="题材偏好" hint={`${stats.tags.length} 类`} icon={<Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />}>
                <BucketRows items={stats.tags} total={stats.total} empty="还没有标签" />
              </Panel>

              {/* 器材 */}
              <Panel title="机身与镜头" hint={`${stats.exifCount} 张带 EXIF`} icon={<Camera className="h-3.5 w-3.5" strokeWidth={1.7} />}>
                {stats.bodies.length === 0 && stats.lenses.length === 0 ? (
                  <EmptyLine text="照片里没有读到 EXIF，可能经过压缩或导出" />
                ) : (
                  <div className="grid gap-3.5">
                    <BucketRows items={stats.bodies} total={stats.exifCount} empty="没有机身信息" label="机身" compact />
                    <BucketRows items={stats.lenses} total={stats.exifCount} empty="没有镜头信息" label="镜头" compact />
                  </div>
                )}
              </Panel>

              {/* 焦段 */}
              <Panel title="焦段习惯" hint={stats.focalTop ? `最常用 ${stats.focalTop.name}` : '缺焦距信息'} icon={<Aperture className="h-3.5 w-3.5" strokeWidth={1.7} />}>
                <BucketRows items={stats.focals} total={stats.exifCount} empty="没有焦距信息" />
              </Panel>

              {/* 光圈 */}
              <Panel title="光圈偏好" hint="看你是不是总在开大光圈" icon={<Aperture className="h-3.5 w-3.5" strokeWidth={1.7} />}>
                <BucketRows items={stats.apertures} total={stats.exifCount} empty="没有光圈信息" />
              </Panel>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function buildSummary(stats: ArchiveStats): string | null {
  if (stats.total === 0) return null;
  const parts: string[] = [];

  parts.push(`一共 ${stats.total} 张照片，分布在 ${stats.shootingDays} 天里`);
  if (stats.avgScore !== null) {
    parts.push(`平均 ${stats.avgScore.toFixed(1)} 分${stats.bestScore !== null ? `，最好的一张 ${stats.bestScore.toFixed(1)}` : ''}`);
  }
  if (stats.busiestHour !== null) {
    parts.push(`按快门最多的时段是${hourSegment(stats.busiestHour)}（${formatHour(stats.busiestHour)} 前后）`);
  }
  const body = stats.bodies[0];
  const focal = stats.focals[0];
  if (body || focal) {
    const who = body ? body.name : '';
    const lens = focal ? `${focal.name} 这一段焦段` : '';
    parts.push(`常拿${who ? ` ${who} ` : ''}${lens ? `配 ${lens}` : ''}出手`.replace(/\s+/g, ' '));
  }
  const tag = stats.tags[0];
  if (tag) parts.push(`题材上最常出现的是「${tag.name}」`);

  return `${parts.join('，')}。`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function Kpi({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
}) {
  return (
    <div className="ps-card rounded-[14px] border border-line/60 bg-surface/60 px-4 py-3.5">
      <p className="text-[11px] text-ink-faint">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-[24px] leading-none font-medium tabular-nums text-ink">{value}</span>
        {unit && <span className="text-[11.5px] text-ink-faint">{unit}</span>}
      </p>
      <p className="mt-1.5 truncate text-[11px] text-ink-faint">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="ps-card rounded-[14px] border border-line/60 bg-surface/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-ink-mid">
          {icon}
        </span>
        <h2 className="text-[12.5px] font-medium text-ink">{title}</h2>
        <span className="ml-auto truncate text-[10.5px] text-ink-faint">{hint}</span>
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="py-6 text-center text-[11.5px] text-ink-faint">{text}</p>
  );
}

function TrendChart({ points }: { points: MonthPoint[] }) {
  const W = 340;
  const H = 108;
  const padX = 4;
  const padY = 10;

  const values = points.filter((p) => p.avg !== null).map((p) => p.avg as number);
  const min = Math.max(0, Math.floor((Math.min(...values) - 4) / 5) * 5);
  const max = Math.min(100, Math.ceil((Math.max(...values) + 4) / 5) * 5);
  const span = Math.max(5, max - min);

  const x = (i: number): number =>
    padX + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - padX * 2));
  const y = (v: number): number => padY + (1 - (v - min) / span) * (H - padY * 2);

  // 按 null 断段，避免把断掉的月份连成一条假线
  const segments: { i: number; v: number }[][] = [];
  let current: { i: number; v: number }[] = [];
  points.forEach((p, i) => {
    if (p.avg === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ i, v: p.avg });
  });
  if (current.length > 0) segments.push(current);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[118px] w-full" role="img" aria-label="近十二个月平均分趋势">
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padX}
            x2={W - padX}
            y1={padY + ratio * (H - padY * 2)}
            y2={padY + ratio * (H - padY * 2)}
            className="stroke-line/50"
            strokeWidth={0.6}
            strokeDasharray={ratio === 1 ? undefined : '2 3'}
          />
        ))}
        {segments.map((seg, si) => {
          const d = seg
            .map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
            .join(' ');
          return (
            <g key={si}>
              <path d={d} fill="none" className="stroke-ink/70" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
              {seg.map((p) => (
                <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2} className="fill-ink" />
              ))}
            </g>
          );
        })}
        {/* 首末点数值，省得再画坐标轴 */}
        {(() => {
          const scored = points.map((p, i) => ({ ...p, i })).filter((p) => p.avg !== null);
          const first = scored[0];
          const last = scored.at(-1);
          if (!first || !last) return null;
          return (
            <>
              <text x={x(first.i)} y={y(first.avg as number) - 6} textAnchor="start" className="fill-ink-faint text-[7px]">
                {first.avg!.toFixed(1)}
              </text>
              <text
                x={x(last.i)}
                y={y(last.avg as number) - 6}
                textAnchor={last.i === 0 ? 'start' : 'end'}
                className="fill-ink text-[7.5px] font-medium"
              >
                {last.avg!.toFixed(1)}
              </text>
            </>
          );
        })()}
      </svg>
      <div className="mt-1 flex justify-between text-[9.5px] text-ink-faint">
        <span>{points[0]?.label}</span>
        <span>{points[Math.floor(points.length / 2)]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function VolumeBars({ points }: { points: MonthPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div>
      <div className="flex h-[92px] items-end gap-1">
        {points.map((p) => {
          const height = p.count === 0 ? 2 : Math.max(6, Math.round((p.count / max) * 84));
          return (
            <div key={p.key} className="group/bar relative flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[8.5px] tabular-nums text-ink-faint opacity-0 transition-opacity duration-150 group-hover/bar:opacity-100">
                {p.count}
              </span>
              <div
                className={cn(
                  'w-full rounded-t-[3px] transition-colors duration-200',
                  p.count === 0 ? 'bg-line/50' : 'bg-ink/25 group-hover/bar:bg-ink/45',
                )}
                style={{ height }}
                title={`${p.label} · ${p.count} 张`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9.5px] text-ink-faint">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function HourHeat({ hours, busiest }: { hours: number[]; busiest: number | null }) {
  const max = Math.max(1, ...hours);
  if (hours.every((h) => h === 0)) return <EmptyLine text="照片缺拍摄时间，画不出时段分布" />;

  return (
    <div>
      <div className="flex h-[74px] items-end gap-[2px]">
        {hours.map((count, hour) => {
          const height = count === 0 ? 2 : Math.max(5, Math.round((count / max) * 66));
          const isPeak = busiest === hour;
          return (
            <div
              key={hour}
              className={cn(
                'flex-1 rounded-[2px] transition-colors duration-200',
                count === 0 ? 'bg-line/40' : isPeak ? 'bg-ink/80' : 'bg-ink/25 hover:bg-ink/45',
              )}
              style={{ height }}
              title={`${formatHour(hour)} · ${count} 张`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9.5px] text-ink-faint">
        {['0点', '6点', '12点', '18点', '23点'].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function BucketRows({
  items,
  total,
  empty,
  label,
  compact,
}: {
  items: Bucket[];
  total: number;
  empty: string;
  label?: string;
  compact?: boolean;
}) {
  if (items.length === 0) return <EmptyLine text={empty} />;
  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className={cn('w-full', compact && 'grid gap-1')}>
      {label && <p className="mb-1 text-[10px] text-ink-faint">{label}</p>}
      <div className={cn('grid', compact ? 'gap-1' : 'gap-2')}>
        {items.map((item) => {
          const ratio = Math.max(0.06, item.count / max);
          const share = total > 0 ? Math.round((item.count / total) * 100) : 0;
          return (
            <div key={item.name} className="group/row">
              <div className="mb-1 flex items-baseline gap-2">
                <span className="truncate text-[11.5px] text-ink-mid">{item.name}</span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-ink-faint">
                  {compact ? item.count : `${item.count} · ${share}%`}
                </span>
              </div>
              <div className={cn('overflow-hidden rounded-full bg-surface-2', compact ? 'h-[3px]' : 'h-[5px]')}>
                <div
                  className="h-full rounded-full bg-ink/35 transition-[width] duration-500"
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Hint({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-[14px] border border-line/60 bg-surface/60 px-5 py-10 text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="mt-1.5 text-[12px] text-ink-faint">{hint}</p>
    </div>
  );
}
