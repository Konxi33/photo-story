// src/components/workbench/PhotoEditorSheet.tsx
'use client';

import { useState } from 'react';
import { Images, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { analyzePhotoLocally, analyzePhotoWithDescription } from '@/lib/ai';
import { deriveSceneTitle } from '@/lib/ai/polish';
import { formatAperture, formatShutter, type ExifInfo } from '@/lib/image/exif';
import { AssetRepository, PhotoRepository } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { Photo, PhotoAnalysis, Technique } from '@/types/domain';

interface PhotoEditorSheetProps {
  photo: Photo | null;
  /** 父组件已生成的缩略图 objectURL */
  previewUrl?: string;
  onClose: () => void;
  onSaved: (photo: Photo) => void;
}

const STORY_SOFT_LIMIT = 200;
const TITLE_LIMIT = 20;

export function PhotoEditorSheet({ photo, previewUrl, onClose, onSaved }: PhotoEditorSheetProps) {
  if (!photo) return null;

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <PhotoEditorForm
          key={photo.id}
          photo={photo}
          previewUrl={previewUrl}
          onClose={onClose}
          onSaved={onSaved}
        />
      </SheetContent>
    </Sheet>
  );
}

function PhotoEditorForm({
  photo,
  previewUrl,
  onClose,
  onSaved,
}: {
  photo: Photo;
  previewUrl?: string;
  onClose: () => void;
  onSaved: (photo: Photo) => void;
}) {
  const a = photo.analysis;

  const [title, setTitle] = useState(a?.title ?? '');
  const [titleNote, setTitleNote] = useState<string | null>(null);
  const [story, setStory] = useState(a?.story ?? '');
  const [composition, setComposition] = useState(a?.technique.composition ?? '');
  const [lighting, setLighting] = useState(a?.technique.lighting ?? '');
  const [color, setColor] = useState(a?.technique.color ?? '');
  const [lens, setLens] = useState(a?.technique.lens ?? '');
  const [post, setPost] = useState(a?.technique.post ?? '');
  const [tagsText, setTagsText] = useState((a?.tags ?? []).join(', '));
  const [mood, setMood] = useState(a?.mood ?? '');
  const [alt, setAlt] = useState(a?.alt ?? '');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [description, setDescription] = useState('');
  const [describing, setDescribing] = useState(false);

  const storyOverLimit = story.length > STORY_SOFT_LIMIT;

  const handleSave = async (): Promise<void> => {
    const technique: Technique = {
      composition: composition.trim(),
      lighting: lighting.trim(),
      color: color.trim(),
      lens: lens.trim(),
      post: post.trim(),
    };

    const analysis: PhotoAnalysis = {
      title: title.trim(),
      story: story.trim(),
      technique,
      tags: tagsText
        .split(/[，,]/)
        .map((t) => t.trim())
        .filter(Boolean),
      mood: mood.trim(),
      alt: alt.trim(),
      // 手改其余字段时保留 0.3.1 的拍摄参数与建议
      ...(photo.analysis?.params ? { params: photo.analysis.params } : {}),
      ...(photo.analysis?.whyGood ? { whyGood: photo.analysis.whyGood } : {}),
      ...(photo.analysis?.improve ? { improve: photo.analysis.improve } : {}),
      ...(photo.analysis?.imitate ? { imitate: photo.analysis.imitate } : {}),
    };

    setSaving(true);
    try {
      const now = Date.now();
      const patch: Partial<Photo> = { analysis, isEdited: true };
      if (photo.status !== 'success') {
        patch.status = 'success';
        patch.meta = {
          model: photo.meta?.model ?? '',
          promptVersion: photo.meta?.promptVersion ?? '',
          temperature: photo.meta?.temperature ?? 0.7,
          source: 'manual-edit',
          createdAt: photo.meta?.createdAt ?? now,
          updatedAt: now,
        };
      } else if (photo.meta) {
        patch.meta = { ...photo.meta, source: 'manual-edit', updatedAt: now };
      }

      const updated = await PhotoRepository.update(photo.id, patch);
      onSaved(updated);
      toast.success('已保存');
      onClose();
    } catch (error) {
      toast.error('保存失败', { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const applyAnalysis = (next: PhotoAnalysis): void => {
    setTitle(next.title);
    setStory(next.story);
    setComposition(next.technique.composition);
    setLighting(next.technique.lighting);
    setColor(next.technique.color);
    setLens(next.technique.lens);
    setPost(next.technique.post);
    setTagsText(next.tags.join(', '));
    setMood(next.mood);
    setAlt(next.alt);
  };

  const handleRegenerate = async (): Promise<void> => {
    setRegenerating(true);
    try {
      const asset = await AssetRepository.get(photo.id, 'ai');
      if (!asset) throw new Error('找不到这张照片的识别用图');

      const result = await analyzePhotoLocally(photo.id, asset.blob, asset.mime);
      if (!result.ok) {
        toast.error('重新生成失败', { description: result.error.message });
        return;
      }

      applyAnalysis(result.analysis);
      toast.success('已生成新内容', { description: '确认无误后点保存写入' });
    } catch (error) {
      toast.error('重新生成失败', { description: (error as Error).message });
    } finally {
      setRegenerating(false);
    }
  };

  /** 纯文本模型可用：用一句话描述画面，让 AI 写成故事 */
  const handleDescribe = async (): Promise<void> => {
    const desc = description.trim();
    if (desc.length < 10) {
      toast.error('描述太短', { description: '至少写 10 个字，说明画面里有什么' });
      return;
    }
    setDescribing(true);
    try {
      const result = await analyzePhotoWithDescription(photo.id, desc);
      if (!result.ok) {
        toast.error('生成失败', { description: result.error.message });
        return;
      }
      applyAnalysis(result.analysis);
      toast.success('已生成新内容', { description: '确认无误后点保存写入' });
    } catch (error) {
      toast.error('生成失败', { description: (error as Error).message });
    } finally {
      setDescribing(false);
    }
  };

  const busy = saving || regenerating || describing;

  return (
    <>
      {/* 固定头 */}
      <SheetHeader className="shrink-0 space-y-1 border-b border-line/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <SheetTitle className="text-[15px]">编辑照片</SheetTitle>
          <span className="rounded-full border border-line/60 bg-surface-2/70 px-2 py-[1px] text-[10px] text-ink-mid">
            {photo.status === 'success' ? '已生成' : photo.status === 'idle' ? '待处理' : photo.status === 'failed' ? '失败' : '处理中'}
          </span>
        </div>
        <SheetDescription className="truncate text-[11.5px] text-ink-faint">{photo.fileName}</SheetDescription>
      </SheetHeader>

      {/* 主体：宽屏左右分栏（照片常驻左侧、字段独立滚动），窄屏上下堆叠 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        {/* 左栏：照片 + 真实拍摄参数 */}
        <div className="flex min-h-0 flex-col gap-3 border-b border-line/50 bg-surface-2/25 p-4 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="overflow-hidden rounded-xl border border-line/60 bg-surface-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={photo.analysis?.alt ?? photo.fileName}
                className="max-h-[36vh] w-full object-contain md:max-h-[46vh]"
              />
            ) : (
              <div className="flex h-40 items-center justify-center">
                <Images className="h-8 w-8 text-ink-faint" strokeWidth={1.4} />
              </div>
            )}
          </div>

          {/* 0.4.2：真实拍摄参数（只读，来自 EXIF；读不到就整块不显示） */}
          {photo.exif && <ExifBlock exif={photo.exif} />}

          <div className="mt-auto hidden gap-1 rounded-xl border border-line/50 bg-surface/50 px-3 py-2 text-[11px] leading-relaxed text-ink-faint md:grid">
            <span>标题压在 10 字以内、故事 40–110 字，最接近获奖图注的读感。</span>
            <span>手改后会标「已手改」，点「重新生成」会用 AI 覆盖当前文字。</span>
          </div>
        </div>

        {/* 右栏：可编辑字段（独立滚动，照片不跟着走） */}
        <div className="grid content-start gap-3.5 p-4 md:min-h-0 md:overflow-y-auto md:overscroll-contain">

          <div className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="edit-title" className="ps-eyebrow">
                标题
              </Label>
              <span className="text-[11px] tabular-nums text-ink-faint">
                {title.length}/{TITLE_LIMIT}
              </span>
            </div>
            <Input
              id="edit-title"
              value={title}
              maxLength={TITLE_LIMIT}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：雨停之前"
            />
            {/* 0.7.6：标题更像「图注」而不是「道具名」。这里给一个不花钱的出口：
                从这篇故事里重新找一句有局面的短句，直接换上去，不走 API */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] leading-relaxed text-ink-faint">
                写这一帧在干什么、像什么，别写成里面有什么。
              </span>
              <button
                type="button"
                className="ps-chip shrink-0 px-2 py-1 text-[11px]"
                onClick={() => {
                  const next = deriveSceneTitle(story);
                  if (!next) {
                    setTitleNote('这段故事里没找到像标题的短句，可以再改改故事，或者手写一个。');
                    return;
                  }
                  setTitle(next);
                  setTitleNote(`已从故事里取「${next}」，没花钱，也没再调模型。`);
                }}
              >
                从故事里取一个
              </button>
            </div>
            {titleNote && (
              <p className="text-[11px] leading-relaxed text-ink-faint" aria-live="polite">
                {titleNote}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="edit-story" className="ps-eyebrow">
                故事
              </Label>
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  storyOverLimit ? 'text-destructive' : 'text-ink-faint',
                )}
              >
                {story.length}/{STORY_SOFT_LIMIT}
              </span>
            </div>
            <Textarea
              id="edit-story"
              rows={6}
              value={story}
              onChange={(e) => setStory(e.target.value)}
              placeholder="围绕照片写一段 120–200 字的故事或画面叙事"
              className="resize-y"
            />
          </div>

          <fieldset className="grid gap-3 rounded-xl border border-line/60 bg-surface-2/40 p-3 sm:grid-cols-2">
            <legend className="px-1 text-[11px] text-ink-faint">拍摄手法</legend>
            <TechField id="tech-composition" label="构图" value={composition} onChange={setComposition} />
            <TechField id="tech-lighting" label="光线" value={lighting} onChange={setLighting} />
            <TechField id="tech-color" label="色彩" value={color} onChange={setColor} />
            <TechField id="tech-lens" label="镜头" value={lens} onChange={setLens} />
            <TechField id="tech-post" label="后期" value={post} onChange={setPost} />
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="edit-tags" className="ps-eyebrow">
              标签（逗号分隔）
            </Label>
            <Input
              id="edit-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="晨雾, 归途, 安静"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-mood" className="ps-eyebrow">
              氛围
            </Label>
            <Input
              id="edit-mood"
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              placeholder="清冷 · 朦胧 · 克制"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-alt" className="ps-eyebrow">
              无障碍描述
            </Label>
            <Input
              id="edit-alt"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="一句话客观描述照片内容"
            />
          </div>

          {/* 纯文本模型兜底 */}
          <div className="grid gap-2 rounded-xl border border-line/60 bg-surface-2/40 p-3">
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-mid">
              <Sparkles className="h-3.5 w-3.5 text-ink-faint" />
              模型看不了图？用文字描述生成
            </div>
            <Textarea
              id="edit-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例：清晨的村道，薄雾，一个人骑车经过，逆光，画面偏青灰"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-ink-faint">描述越具体，故事越准</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full"
                onClick={() => void handleDescribe()}
                disabled={busy}
              >
                <Wand2 className="mr-1 h-3.5 w-3.5" />
                {describing ? '生成中…' : '用描述生成'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 固定底栏 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line/60 bg-surface/80 px-4 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full"
          onClick={() => void handleRegenerate()}
          disabled={busy}
        >
          {regenerating ? '重新生成中…' : '重新生成'}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </Button>
          <Button size="sm" className="h-8 rounded-full px-4" onClick={() => void handleSave()} disabled={busy}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </>
  );
}

function TechField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-[11px] text-ink-faint">
        {label}
      </Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}

/** 0.4.2：照片自带的真实参数，只读展示——和 AI 写的「拍摄手法」区分开 */
function ExifBlock({ exif }: { exif: ExifInfo }) {
  const rows: { label: string; value: string }[] = [];
  const camera = [exif.make, exif.model].filter(Boolean).join(' ').trim();
  if (camera) rows.push({ label: '机身', value: camera });
  if (exif.lens) rows.push({ label: '镜头', value: exif.lens });

  const exposure = [
    formatAperture(exif.aperture),
    formatShutter(exif.shutter),
    exif.iso ? `ISO${exif.iso}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (exposure) rows.push({ label: '曝光', value: exposure });

  const focal = [exif.focal35 ? `${exif.focal35}mm` : exif.focal ? `${Math.round(exif.focal)}mm` : null]
    .filter(Boolean)
    .join('');
  if (focal) rows.push({ label: '焦距', value: exif.focal35 ? `${focal}（等效）` : focal });

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-line/60 bg-surface-2/60 px-3 py-2.5">
      <div className="ps-eyebrow mb-1.5 flex items-center gap-1.5">
        <Images className="h-3 w-3" />
        照片参数
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-ink-faint">{row.label}</dt>
            <dd className="tabular-nums text-ink-mid">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}