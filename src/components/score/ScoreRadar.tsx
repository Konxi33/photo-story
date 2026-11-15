// src/components/score/ScoreRadar.tsx
'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

export interface RadarAxis {
  label: string;
  value: number;
}

/**
 * 0.5.0：评分维度雷达图。
 *
 * 纯 SVG、无第三方图表库（离线可用），把六项分数摊成一个形状——
 * 条形图只能逐个看高低，雷达能一眼看出「哪一维塌下去了」。
 */
export function ScoreRadar({
  axes,
  size = 220,
  className,
  compareAxes,
  compareLabel,
}: {
  axes: RadarAxis[];
  size?: number;
  className?: string;
  /** 可选：叠加一组对比数据（例如本组平均） */
  compareAxes?: RadarAxis[];
  compareLabel?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 30;
  const count = Math.max(3, axes.length);

  const point = (index: number, ratio: number): [number, number] => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    const r = radius * Math.max(0, Math.min(1.15, ratio));
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };

  const polygon = (list: RadarAxis[]): string =>
    list
      .map((axis, index) => point(index, axis.value / 100).join(','))
      .join(' ');

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="评分维度雷达图">
        <defs>
          <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* 网格 */}
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={axes
              .map((_, index) => point(index, ring).join(','))
              .join(' ')}
            fill="none"
            className="stroke-line/70"
            strokeWidth={0.75}
          />
        ))}
        {axes.map((axis, index) => {
          const [x, y] = point(index, 1);
          return (
            <line
              key={axis.label}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              className="stroke-line/60"
              strokeWidth={0.75}
            />
          );
        })}

        {/* 对比组（本组平均） */}
        {compareAxes && compareAxes.length === axes.length && (
          <polygon
            points={polygon(compareAxes)}
            fill="none"
            className="stroke-ink-light/60"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* 本组数据 */}
        <polygon
          points={polygon(axes)}
          fill={`url(#fill-${gid})`}
          className="stroke-ink text-ink"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {axes.map((axis, index) => {
          const [x, y] = point(index, axis.value / 100);
          return <circle key={axis.label} cx={x} cy={y} r={2.2} className="fill-ink" />;
        })}

        {/* 轴标签 */}
        {axes.map((axis, index) => {
          const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
          const lx = cx + Math.cos(angle) * (radius + 16);
          const ly = cy + Math.sin(angle) * (radius + 16);
          const anchor = Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
          return (
            <text
              key={axis.label}
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-ink-mid text-[9px]"
            >
              {axis.label}
            </text>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <i className="h-1.5 w-1.5 rounded-full bg-ink" />
          当前
        </span>
        {compareAxes && (
          <span className="inline-flex items-center gap-1">
            <i className="h-px w-3 bg-ink-light" />
            {compareLabel ?? '对比'}
          </span>
        )}
      </div>
    </div>
  );
}
