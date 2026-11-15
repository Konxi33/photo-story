// src/components/workbench/BatchTagsDialog.tsx
// 0.5.6：批量改标签与氛围——选一堆照片，统一加几个词、去掉几个词、换成同一个氛围。

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Tags } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PhotoRepository } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { Photo } from '@/types/domain';

const KEEP_MOOD = '__keep__';

interface BatchTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: Photo[];
  onDone?: () => void;
}

export function BatchTagsDialog({
  open,
  onOpenChange,
  photos,
  onDone,
}: BatchTagsDialogProps): React.JSX.Element {
  const [addText, setAddText] = useState('');
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [mood, setMood] = useState<string>(KEEP_MOOD);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAddText('');
    setRemoving(new Set());
    setMood(KEEP_MOOD);
  }, [open]);

  // 选中照片里出现过的标签，按出现次数排序——常见词排前面更好点
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const photo of photos) {
      for (const tag of photo.analysis?.tags ?? []) {
        const key = tag.trim();
        if (!key) continue;
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  }, [photos]);

  const moodCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const photo of photos) {
      const key = photo.analysis?.mood?.trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.keys()].sort();
  }, [photos]);

  const parsed = useMemo(
    () =>
      addText
        .split(/[,，、\s]+/)
        .map((item) => item.trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 8),
    [addText],
  );

  const editable = photos.filter((photo) => photo.analysis);
  const nothingToDo = parsed.length === 0 && removing.size === 0 && mood === KEEP_MOOD;

  const handleApply = async (): Promise<void> => {
    if (editable.length === 0) {
      toast('所选照片还没有文案', { description: '先跑一次 AI 生成，再来改标签' });
      return;
    }
    setBusy(true);
    try {
      for (const photo of editable) {
        const analysis = photo.analysis;
        if (!analysis) continue;
        const kept = (analysis.tags ?? []).filter((tag) => !removing.has(tag.trim()));
        const merged: string[] = [];
        for (const tag of [...kept, ...parsed]) {
          const clean = tag.trim();
          if (clean && !merged.includes(clean)) merged.push(clean);
        }
        await PhotoRepository.update(photo.id, {
          analysis: {
            ...analysis,
            tags: merged.slice(0, 10),
            mood: mood === KEEP_MOOD ? analysis.mood : mood,
          },
        });
      }
      toast.success('已更新 ' + editable.length + ' 张', {
        description: '标签与氛围已写进这些照片',
      });
      onDone?.();
      onOpenChange(false);
    } catch (error) {
      toast.error('批量更新失败', { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="size-4" />
            批量标签
          </DialogTitle>
          <DialogDescription>
            对选中的 {photos.length} 张照片统一加词、去词、换氛围。
            {photos.length !== editable.length
              ? ` 其中 ${photos.length - editable.length} 张还没有文案，会被跳过。`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <label className="grid gap-2">
            <span className="text-[12px] font-medium text-ink-soft">加这些标签</span>
            <Input
              onChange={(event) => setAddText(event.target.value)}
              placeholder="用逗号分隔，比如：夜景, 长曝光, 城市"
              value={addText}
            />
            {parsed.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {parsed.map((tag) => (
                  <span
                    className="rounded-full bg-ink/6 px-2 py-0.5 text-[11px] text-ink-soft"
                    key={tag}
                  >
                    #{tag}
                  </span>
                ))}
              </span>
            ) : null}
          </label>

          {tagCounts.length > 0 ? (
            <div className="grid gap-2">
              <span className="text-[12px] font-medium text-ink-soft">
                点一下去掉这些标签
              </span>
              <div className="flex flex-wrap gap-1.5">
                {tagCounts.map(([tag, count]) => {
                  const active = removing.has(tag);
                  return (
                    <button
                      className={cn(
                        'ps-pressable rounded-full border px-2.5 py-1 text-[11.5px] transition-colors duration-150',
                        active
                          ? 'border-destructive/40 bg-destructive/10 text-destructive line-through'
                          : 'border-line/70 text-ink-soft hover:bg-ink/6',
                      )}
                      key={tag}
                      onClick={() =>
                        setRemoving((prev) => {
                          const next = new Set(prev);
                          if (next.has(tag)) next.delete(tag);
                          else next.add(tag);
                          return next;
                        })
                      }
                      type="button"
                    >
                      #{tag}
                      <span className="ml-1 text-ink-faint">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <label className="grid gap-2">
            <span className="text-[12px] font-medium text-ink-soft">氛围</span>
            <Select onValueChange={setMood} value={mood}>
              <SelectTrigger>
                <SelectValue placeholder="保持各自的氛围" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP_MOOD}>保持各自的氛围</SelectItem>
                {moodCounts.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
                <SelectItem value="安静">安静</SelectItem>
                <SelectItem value="热烈">热烈</SelectItem>
                <SelectItem value="克制的怀旧">克制的怀旧</SelectItem>
                <SelectItem value="潮湿的夜色">潮湿的夜色</SelectItem>
                <SelectItem value="轻快的日常">轻快的日常</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="ghost">
            取消
          </Button>
          <Button disabled={busy || nothingToDo} onClick={() => void handleApply()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            应用到 {editable.length} 张
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
