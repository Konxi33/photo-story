// src/components/workbench/GenStyleSheet.tsx
// 0.7.7：项目里就能改「怎么写」。
// 以前标题风格 / 叙事笔法 / 故事长度只能在全局设置页调，进了项目发现不合适就得退出去，
// 这个面板把这三件事搬到项目工作台里，改完立刻对下一次生成生效（已经生成的照片不动）。
//
// 0.8.2 补丁：多一项「标题字数」——用户反馈「不能自定义字数范围」。
// 给四个预设（1–4 / 2–8 / 4–12 / 6–18）+ 自定义上下限；上限是硬约束，下限交给模型要求。

'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  NARRATIVE_STYLES,
  STORY_LENGTHS,
  TITLE_RANGES,
  TITLE_STYLES,
  clampTitleRange,
  styleExamples,
} from '@/config/styles';
import { STORAGE_KEY_APP_SETTINGS } from '@/config/app';
import { KvRepository } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { AppSettings, NarrativeStyle, StoryLength, TitleRange, TitleStyle } from '@/types/domain';

export interface WritingSettings {
  titleStyle: TitleStyle;
  titleRange: TitleRange;
  narrativeStyle: NarrativeStyle;
  storyLength: StoryLength;
}

interface GenStyleSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: WritingSettings;
  onSaved: (next: WritingSettings) => void;
}

/** 三种常见口味的组合，省得一项一项去点 */
const PRESETS: { id: string; label: string; hint: string; value: WritingSettings }[] = [
  {
    id: 'caption',
    label: '像图注',
    hint: '短、克制、只写画面里有的',
    value: {
      titleStyle: 'plain',
      titleRange: { min: 2, max: 8 },
      narrativeStyle: 'terse',
      storyLength: 'short',
    },
  },
  {
    id: 'essay',
    label: '像随笔',
    hint: '有画面也有语气，中等长度',
    value: {
      titleStyle: 'literary',
      titleRange: { min: 2, max: 10 },
      narrativeStyle: 'essay',
      storyLength: 'medium',
    },
  },
  {
    id: 'documentary',
    label: '像纪实',
    hint: '冷静、按时间线铺开',
    value: {
      titleStyle: 'cinematic',
      titleRange: { min: 2, max: 8 },
      narrativeStyle: 'documentary',
      storyLength: 'long',
    },
  },
];

/** 当前范围命中哪个预设（没有就是自定义） */
function rangePresetId(range: TitleRange): string {
  const hit = TITLE_RANGES.find((r) => r.min === range.min && r.max === range.max);
  return hit?.id ?? 'custom';
}

export function GenStyleSheet({ open, onOpenChange, value, onSaved }: GenStyleSheetProps) {
  const [draft, setDraft] = useState<WritingSettings>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const titleStyleOption = TITLE_STYLES.find((s) => s.id === draft.titleStyle);
  const titleHint = titleStyleOption?.hint ?? '';
  const titleExamples = titleStyleOption ? styleExamples(titleStyleOption) : [];
  const storyHint = NARRATIVE_STYLES.find((s) => s.id === draft.narrativeStyle)?.hint ?? '';
  const range = draft.titleRange;

  const setRange = (next: Partial<TitleRange>): void => {
    setDraft((prev) => ({ ...prev, titleRange: clampTitleRange({ ...prev.titleRange, ...next }) }));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS);
      const next: AppSettings = {
        ...(saved ?? ({} as AppSettings)),
        titleStyle: draft.titleStyle,
        titleRange: draft.titleRange,
        narrativeStyle: draft.narrativeStyle,
        storyLength: draft.storyLength,
      };
      await KvRepository.set(STORAGE_KEY_APP_SETTINGS, next);
      // 全局设置页与其它页面靠这个事件刷新自己的显示
      window.dispatchEvent(new CustomEvent('ps:settings-saved', { detail: next }));
      onSaved(draft);
      toast.success('写法已更新', { description: '下一次生成按这个来；已经生成的照片不会自动改。' });
      onOpenChange(false);
    } catch (error) {
      toast.error('保存失败', { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>写法</DialogTitle>
          <DialogDescription>
            决定标题怎么写、故事怎么讲、写多长。改完对下一次生成生效，已经生成的不会自动变。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <span className="ps-eyebrow">先挑一种口味</span>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((preset) => {
                const active =
                  preset.value.titleStyle === draft.titleStyle &&
                  preset.value.narrativeStyle === draft.narrativeStyle &&
                  preset.value.storyLength === draft.storyLength;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDraft(preset.value)}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition-colors duration-200',
                      active
                        ? 'border-copper/55 bg-copper/8'
                        : 'border-line/70 hover:border-ink/20 hover:bg-surface-2/60',
                    )}
                  >
                    <span className="block text-[13px] font-medium text-ink">{preset.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
                      {preset.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <span className="ps-eyebrow">标题</span>
            <Segmented
              block
              size="sm"
              ariaLabel="标题写法"
              value={draft.titleStyle}
              onChange={(next) => setDraft((prev) => ({ ...prev, titleStyle: next }))}
              options={TITLE_STYLES.map((style) => ({ value: style.id, label: style.label }))}
            />
            <p className="text-[11.5px] leading-relaxed text-ink-faint">{titleHint}</p>
            {titleExamples.length > 0 && (
              <p className="text-[11px] leading-relaxed text-ink-faint/80">
                例如：{titleExamples.join(' · ')}
              </p>
            )}
          </div>

          {/* 0.8.2 补丁：标题字数范围 */}
          <div className="grid gap-2">
            <span className="ps-eyebrow">标题字数</span>
            <Segmented
              block
              size="sm"
              ariaLabel="标题字数范围"
              value={rangePresetId(range)}
              onChange={(next) => {
                const preset = TITLE_RANGES.find((r) => r.id === next);
                if (preset) setRange({ min: preset.min, max: preset.max });
                else setRange({ min: range.min, max: range.max });
              }}
              options={[
                ...TITLE_RANGES.map((r) => ({ value: r.id, label: r.label.replace(/\s*字?（.*$/, '') })),
                { value: 'custom', label: '自定义' },
              ]}
            />
            <div className="flex items-center gap-2 text-[11.5px] text-ink-faint">
              <span>最少</span>
              <Input
                type="number"
                min={1}
                max={24}
                value={range.min}
                aria-label="标题最少字数"
                onChange={(e) => setRange({ min: Number(e.target.value) })}
                className="h-8 w-16 text-center"
              />
              <span>最多</span>
              <Input
                type="number"
                min={1}
                max={24}
                value={range.max}
                aria-label="标题最多字数"
                onChange={(e) => setRange({ max: Number(e.target.value) })}
                className="h-8 w-16 text-center"
              />
              <span className="text-ink-faint/80">最多字数是硬约束，超过会被截短。</span>
            </div>
          </div>

          <div className="grid gap-2">
            <span className="ps-eyebrow">叙事笔法</span>
            <Segmented
              block
              size="sm"
              ariaLabel="叙事笔法"
              value={draft.narrativeStyle}
              onChange={(next) => setDraft((prev) => ({ ...prev, narrativeStyle: next }))}
              options={NARRATIVE_STYLES.map((style) => ({ value: style.id, label: style.label }))}
            />
            <p className="text-[11.5px] leading-relaxed text-ink-faint">{storyHint}</p>
          </div>

          <div className="grid gap-2">
            <span className="ps-eyebrow">故事长度</span>
            <Segmented
              block
              size="sm"
              ariaLabel="故事长度"
              value={draft.storyLength}
              onChange={(next) => setDraft((prev) => ({ ...prev, storyLength: next }))}
              options={STORY_LENGTHS.map((len) => ({ value: len.id, label: len.label }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存写法'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
