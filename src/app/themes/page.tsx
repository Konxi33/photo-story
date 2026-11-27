// src/app/themes/page.tsx
// 0.5.2 新模块：主题馆。
// 一边用内置的拍摄/写作提示告诉你「这类照片该怎么拍、怎么写」，
// 一边把你自己的照片按题材归好类，顺手看到这个题材下你最好的那张。

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Compass, Loader2, Sparkles } from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { ModuleGuide } from '@/components/module-guide';
import { Button } from '@/components/ui/button';
import { FadeImg } from '@/components/ui/fade-img';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PhotoStoryPreview } from '@/components/workbench/PhotoStoryPreview';
import { ROUTES } from '@/config/app';
import { AssetRepository, PhotoRepository } from '@/lib/db';
import { matchThemes, suggestTheme, type ThemeMatch } from '@/lib/themes/library';
import { cn, withTimeout } from '@/lib/utils';
import type { ScreenRect } from '@/lib/motion';
import type { Photo } from '@/types/domain';

export default function ThemesPage() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetUrls, setSheetUrls] = useState<Record<string, string>>({});
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [origin, setOrigin] = useState<ScreenRect | null>(null);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    void (async () => {
      const list = await withTimeout(PhotoRepository.listAll(), 6000, [] as Photo[]);
      if (cancelled) return;
      setPhotos(list);

      const matches = matchThemes(list);
      const urls: Record<string, string> = {};
      for (const match of matches) {
        const photo = match.best;
        if (!photo) continue;
        try {
          const asset = await AssetRepository.get(photo.id, 'preview');
          if (asset) {
            const url = URL.createObjectURL(asset.blob);
            urls[match.theme.id] = url;
            created.push(url);
          }
        } catch {
          // 单张失败忽略
        }
      }
      if (cancelled) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }
      setCovers(urls);
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, []);

  const matches = useMemo(() => (photos ? matchThemes(photos) : []), [photos]);
  const suggestion = useMemo(() => suggestTheme(matches), [matches]);
  const open = matches.find((m) => m.theme.id === openId) ?? null;

  // 打开主题时按需加载该题材下的缩略图
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const created: string[] = [];

    void (async () => {
      const urls: Record<string, string> = {};
      for (const photo of open.photos.slice(0, 24)) {
        try {
          const asset = await AssetRepository.get(photo.id, 'preview');
          if (!asset) continue;
          const url = URL.createObjectURL(asset.blob);
          urls[photo.id] = url;
          created.push(url);
        } catch {
          // ignore
        }
      }
      if (cancelled) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }
      setSheetUrls(urls);
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
      setSheetUrls({});
    };
  }, [open]);

  return (
    <AppShell>
      <div className="px-5 py-8 md:px-8">
        <header className="mb-6">
          <p className="ps-eyebrow">Themes</p>
          <h1 className="ps-page-title mt-2">主题馆</h1>
          <p className="ps-page-desc mt-2">
            八类常见题材，每一类都写清了「难在哪、怎么拍、怎么写」。你的照片会自动归到对应主题下，点开就能看到这个题材里你最好的那张。
          </p>
        </header>

        {/* 0.5.5：第一次进来先告诉用户这个模块是干什么用的 */}
        <ModuleGuide moduleId="themes" className="mb-5" />

        {photos === null ? (
          <div className="flex items-center gap-2 py-20 text-[13px] text-ink-faint">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在归类…
          </div>
        ) : (
          <>
            {suggestion && (
              <section className="mb-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-line/60 bg-surface/60 px-4 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2">
                  <Compass className="h-3.5 w-3.5 text-ink-mid" strokeWidth={1.6} />
                </span>
                <p className="text-[12.5px] leading-relaxed text-ink-mid">
                  你还没有「{suggestion.name}」的照片。这类题材专门练一件事：{suggestion.tagline}。
                </p>
                <button
                  type="button"
                  onClick={() => setOpenId(suggestion.id)}
                  className="ml-auto shrink-0 text-[12px] text-ink underline-offset-4 hover:underline"
                >
                  看看怎么拍
                </button>
              </section>
            )}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {matches.map((match, index) => (
                <ThemeCard
                  key={match.theme.id}
                  match={match}
                  cover={covers[match.theme.id]}
                  index={index}
                  onOpen={() => setOpenId(match.theme.id)}
                />
              ))}
            </div>

            <p className="mt-6 text-[11.5px] leading-relaxed text-ink-faint">
              归类依据是 AI 生成的标签、氛围与标题；没有命中任何主题的照片不会显示在这里，但仍会出现在照片库。
            </p>
          </>
        )}
      </div>

      <Sheet open={openId !== null} onOpenChange={(value) => (value ? null : setOpenId(null))}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {open && (
            <>
              <SheetHeader>
                <p className="ps-eyebrow">{open.theme.tagline}</p>
                <SheetTitle className="ps-display text-[22px]">{open.theme.name}</SheetTitle>
              </SheetHeader>

              <div className="grid gap-5 px-5 pb-8">
                <div className="flex items-center gap-3 text-[12px] text-ink-faint">
                  <span>{open.photos.length} 张</span>
                  {open.avgScore !== null && (
                    <span className="tabular-nums">平均 {open.avgScore.toFixed(1)} 分</span>
                  )}
                </div>

                <section className="rounded-[12px] border border-line/60 bg-surface-2/50 px-4 py-3">
                  <p className="text-[11px] text-ink-faint">难在哪</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-mid">{open.theme.challenge}</p>
                </section>

                <section>
                  <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={1.7} />
                    怎么拍
                  </p>
                  <ul className="grid gap-1.5">
                    {open.theme.shootTips.map((tip) => (
                      <li key={tip} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-mid">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink/40" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <p className="mb-2 text-[12px] font-medium text-ink">怎么写</p>
                  <ul className="grid gap-1.5">
                    {open.theme.writeTips.map((tip) => (
                      <li key={tip} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-mid">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink/40" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </section>

                {open.photos.length > 0 && (
                  <section>
                    <p className="mb-2 text-[12px] font-medium text-ink">你的这一类</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {open.photos.slice(0, 24).map((photo, i) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setOrigin({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
                            setPreviewIndex(i);
                          }}
                          className="group relative aspect-square overflow-hidden rounded-md border border-line/50 bg-surface-2"
                          title={photo.analysis?.title ?? photo.fileName}
                        >
                          {sheetUrls[photo.id] ? (
                            <FadeImg
                              src={sheetUrls[photo.id]!}
                              alt={photo.analysis?.title ?? photo.fileName}
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.06]"
                            />
                          ) : null}
                          {typeof photo.analysis?.score?.overall === 'number' && (
                            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/55 px-1 font-mono text-[9px] text-white/85">
                              {photo.analysis.score.overall.toFixed(0)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {open && previewIndex !== null && open.photos[previewIndex] && (
        <PhotoStoryPreview
          photos={open.photos.slice(0, 24)}
          index={Math.min(previewIndex, 23)}
          previews={sheetUrls}
          origin={origin}
          onClose={() => setPreviewIndex(null)}
          onNavigate={setPreviewIndex}
        />
      )}

      {photos && photos.length === 0 && (
        <div className="mx-auto mt-4 max-w-md rounded-[14px] border border-dashed border-line/80 bg-surface-2/30 px-5 py-8 text-center">
          <p className="text-[13px] text-ink">还没有照片</p>
          <p className="mt-1 text-[12px] text-ink-faint">导入并生成之后，题材归类会自动出现。</p>
          <Link href={ROUTES.projects}>
            <Button size="sm" className="mt-4 h-8 rounded-full px-4">
              去建项目
            </Button>
          </Link>
        </div>
      )}
    </AppShell>
  );
}

function ThemeCard({
  match,
  cover,
  index,
  onOpen,
}: {
  match: ThemeMatch;
  cover?: string;
  index: number;
  onOpen: () => void;
}) {
  const { theme, photos, avgScore } = match;
  const empty = photos.length === 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
      className={cn(
        'ps-enter group relative overflow-hidden rounded-[14px] border text-left transition-[transform,border-color,box-shadow] duration-300',
        'hover:-translate-y-0.5 hover:shadow-[var(--elev-2)] focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none',
        empty ? 'border-line/50 bg-surface/40' : 'border-line/60 bg-surface/60',
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {cover ? (
          <FadeImg
            src={cover}
            alt={theme.name}
            className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.05] group-hover:opacity-100"
          />
        ) : (
          <div className={cn('h-full w-full bg-gradient-to-br', theme.accent)}>
            <div className="flex h-full items-center justify-center">
              <Compass className="h-7 w-7 text-white/25" strokeWidth={1.2} />
            </div>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5">
          <p className="text-[13.5px] font-medium text-white">{theme.name}</p>
          <p className="mt-0.5 text-[10.5px] text-white/70">{theme.tagline}</p>
        </div>
        <span className="absolute top-2 right-2 rounded-full bg-black/45 px-1.5 py-0.5 text-[10px] tabular-nums text-white/85">
          {photos.length > 0 ? `${photos.length} 张` : '还没拍'}
        </span>
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px] text-ink-faint">
          {avgScore === null ? '—' : `平均 ${avgScore.toFixed(1)}`}
        </span>
        <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-ink-faint transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
      </div>
    </button>
  );
}
