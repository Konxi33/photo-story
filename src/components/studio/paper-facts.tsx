'use client';

// src/components/studio/paper-facts.tsx
// 0.7.2：把「纸面上的规矩」从三段长文字改成三张小图 + 三个图标短句。
//
// 纸张多大、边距多宽、纸上有多少格 —— 这三件事本来就是图形信息，
// 画成比例正确的小图（同一把比例尺：高度都按纸高算）比读「A4 · 边距 2.2cm」快得多。
// 数值一个都没丢，只是从正文变成了图下面的小字。

import { Ban, FileText, Shrink } from 'lucide-react';

import { MiniLayout } from './mini-layout';

interface PaperFactsProps {
  paperLabel: string;
  paperWidthCm: number;
  paperHeightCm: number;
  orientation: 'portrait' | 'landscape';
  marginCm: number;
  gutterCm: number;
  cols: number;
  rows: number;
}

const RULES = [
  { icon: Ban, text: '压住的块拖不动', detail: '积木不能互相压住；压住的话拖不动，会原地弹回。' },
  { icon: Shrink, text: '太小先缩字号', detail: '格子太小会先缩字号，缩到 7.5pt 还放不下就截断，并在导出报告里说明。' },
  { icon: FileText, text: '一张照片只在一页', detail: '一张照片连同它的文字永远只占一页，不会被拆到两页。' },
] as const;

export function PaperFacts({
  paperLabel,
  paperWidthCm,
  paperHeightCm,
  orientation,
  marginCm,
  gutterCm,
  cols,
  rows,
}: PaperFactsProps) {
  // 横放时把宽高对调 —— 小图的形状跟着真实纸张走
  const sheetW = orientation === 'portrait' ? paperWidthCm : paperHeightCm;
  const sheetH = orientation === 'portrait' ? paperHeightCm : paperWidthCm;
  const sheet = { aspectRatio: `${sheetW} / ${sheetH}` };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        {/* 纸张 */}
        <div className="flex flex-col items-center gap-1 rounded-xl border border-line/60 bg-surface-2/30 px-1 py-1.5">
          <div className="flex h-[52px] items-center justify-center">
            <div
              className="grid place-items-center rounded-[2px] bg-[#fbfaf7] ring-1 ring-black/15"
              style={{ ...sheet, height: 44 }}
            >
              <span className="text-[8px] font-medium tracking-wide text-[#6b655c]">
                {paperLabel}
              </span>
            </div>
          </div>
          <span className="text-[10px] text-ink-faint">
            {paperLabel} · {orientation === 'portrait' ? '竖' : '横'}
          </span>
        </div>

        {/* 边距 + 装订线 */}
        <div className="flex flex-col items-center gap-1 rounded-xl border border-line/60 bg-surface-2/30 px-1 py-1.5">
          <div className="flex h-[52px] items-center justify-center">
            <div
              className="relative rounded-[2px] bg-[#fbfaf7] ring-1 ring-black/15"
              style={{ ...sheet, height: 44 }}
            >
              <div
                className="absolute rounded-[1px] border border-dashed border-[#b25c34]/70"
                style={{
                  top: `${(marginCm / sheetH) * 100}%`,
                  bottom: `${(marginCm / sheetH) * 100}%`,
                  left: `${(marginCm / sheetW) * 100}%`,
                  right: `${(marginCm / sheetW) * 100}%`,
                }}
              />
              {gutterCm > 0 ? (
                <div
                  className="absolute rounded-[1px] bg-[#b25c34]/45"
                  style={{
                    top: `${(marginCm / sheetH) * 100}%`,
                    bottom: `${(marginCm / sheetH) * 100}%`,
                    left: `${(marginCm / sheetW) * 100}%`,
                    width: `${(gutterCm / sheetW) * 100}%`,
                  }}
                />
              ) : null}
            </div>
          </div>
          <span className="text-[10px] text-ink-faint">
            边距 {marginCm} · 订 {gutterCm}
          </span>
        </div>

        {/* 栏目 */}
        <div className="flex flex-col items-center gap-1 rounded-xl border border-line/60 bg-surface-2/30 px-1 py-1.5">
          <div className="flex h-[52px] items-center justify-center">
            <MiniLayout items={[]} rules className="w-[26px]" />
          </div>
          <span className="text-[10px] text-ink-faint">
            {cols} 列 × {rows} 行
          </span>
        </div>
      </div>

      <ul className="space-y-1">
        {RULES.map((rule) => {
          const Icon = rule.icon;
          return (
            <li
              key={rule.text}
              title={rule.detail}
              className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[11px] text-ink-mid"
            >
              <Icon className="size-3 shrink-0 text-ink-faint" aria-hidden />
              <span className="truncate">{rule.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
