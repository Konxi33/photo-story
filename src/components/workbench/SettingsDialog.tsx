// src/components/workbench/SettingsDialog.tsx
'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  API_ROUTES,
  APP_NAME,
  APP_VERSION,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
  STORAGE_KEY_APP_SETTINGS,
} from '@/config/app';
import { KvRepository } from '@/lib/db';
import type {
  AiConfigPublic,
  AppSettings,
  SettingsTestResponse,
  SettingsUpdateRequest,
} from '@/types/domain';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o-mini');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [temperature, setTemperature] = useState<number>(DEFAULT_TEMPERATURE);
  const [maxTokens, setMaxTokens] = useState<number>(DEFAULT_MAX_TOKENS);

  const [concurrency, setConcurrency] = useState<number>(DEFAULT_CONCURRENCY);
  const [timeoutSec, setTimeoutSec] = useState<number>(DEFAULT_TIMEOUT_MS / 1000);
  const [maxRetries, setMaxRetries] = useState<number>(DEFAULT_MAX_RETRIES);

  const [hasKey, setHasKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(API_ROUTES.settings, { cache: 'no-store' });
        const data = (await res.json()) as AiConfigPublic;
        if (cancelled) return;
        setBaseURL(data.baseURL);
        setModel(data.model);
        setTemperature(data.temperature);
        setMaxTokens(data.maxTokens);
        setHasKey(data.hasKey);
        setKeyHint(data.keyHint);
        setApiKey('');
      } catch {
        // 拉取失败保留默认表单
      }

      try {
        const saved = await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS);
        if (saved && !cancelled) {
          setConcurrency(saved.concurrency);
          setTimeoutSec(Math.round(saved.timeoutMs / 1000));
          setMaxRetries(saved.maxRetries);
        }
      } catch {
        // 读取失败用默认值
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    try {
      const res = await fetch(API_ROUTES.settingsTest, { method: 'POST' });
      const data = (await res.json()) as SettingsTestResponse;
      if (data.ok) {
        const suffix = data.model ? ' · ' + data.model : '';
        toast.success('连接正常', {
          description: String(data.latencyMs ?? 0) + ' ms' + suffix,
        });
      } else {
        toast.error('连接失败', { description: data.message ?? '未知错误' });
      }
    } catch (error) {
      toast.error('连接失败', { description: (error as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const body: SettingsUpdateRequest = {
        baseURL: baseURL.trim(),
        model: model.trim(),
        temperature,
        maxTokens: Math.min(8192, Math.max(64, Math.round(maxTokens) || DEFAULT_MAX_TOKENS)),
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();

      const res = await fetch(API_ROUTES.settings, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };

      if (!res.ok || !data.ok) {
        toast.error('保存失败', { description: data.message ?? 'HTTP ' + res.status });
        return;
      }

      const fresh = (await fetch(API_ROUTES.settings, { cache: 'no-store' }).then((r) =>
        r.json(),
      )) as AiConfigPublic;
      setHasKey(fresh.hasKey);
      setKeyHint(fresh.keyHint);
      setApiKey('');

      // 生成参数存浏览器本地（IndexedDB），批量生成时读取
      const appSettings: AppSettings = {
        concurrency: Math.min(50, Math.max(1, Math.round(concurrency) || 1)),
        timeoutMs: Math.min(120_000, Math.max(30_000, Math.round(timeoutSec) * 1000)),
        maxRetries: Math.min(3, Math.max(0, Math.round(maxRetries) || 0)),
        aiImageMaxEdge: 1024,
        previewMaxEdge: 640,
        storageNoticeDismissed: false,
      };
      await KvRepository.set(STORAGE_KEY_APP_SETTINGS, appSettings);

      toast.success('设置已保存');
      onOpenChange(false);
    } catch (error) {
      toast.error('保存失败', { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>配置模型与生成参数</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="model" className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="model">模型与密钥</TabsTrigger>
            <TabsTrigger value="generate">生成参数</TabsTrigger>
            <TabsTrigger value="about">关于</TabsTrigger>
          </TabsList>

          <TabsContent value="model" className="grid gap-4">
            <Field label="Base URL" htmlFor="base-url">
              <Input
                id="base-url"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </Field>

            <Field label="模型名" htmlFor="model-name">
              <Input
                id="model-name"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
              />
            </Field>

            <Field label="API Key" htmlFor="api-key">
              <div className="flex gap-2">
                <Input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-lg"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </Field>

            <Field label="温度" htmlFor="temperature">
              <div className="flex items-center gap-3">
                <Slider
                  id="temperature"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[temperature]}
                  onValueChange={(v) => setTemperature(v[0] ?? temperature)}
                  className="flex-1"
                />
                <span className="w-10 text-right text-xs tabular-nums text-ink-mid">
                  {temperature.toFixed(2)}
                </span>
              </div>
            </Field>

            <Field label="最大输出长度（tokens）" htmlFor="max-tokens">
              <div className="flex items-center gap-2">
                <Input
                  id="max-tokens"
                  type="number"
                  min={64}
                  max={8192}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-[11px] text-ink-faint">
                  智谱视觉模型上限 1024，其他模型可设更高
                </span>
              </div>
            </Field>

            <p className={hasKey ? 'text-[11.5px] text-emerald-700 dark:text-emerald-400' : 'text-[11.5px] text-amber-700 dark:text-amber-400'}>
              {hasKey ? '密钥已配置（' + (keyHint ?? '已保存') + '）' : '尚未配置密钥，生成前请先填写'}
            </p>
          </TabsContent>

          <TabsContent value="generate" className="grid gap-4">
            <Field label="并发数" htmlFor="concurrency">
              <Select value={String(concurrency)} onValueChange={(v) => setConcurrency(Number(v))}>
                <SelectTrigger id="concurrency" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 4, 6, 8, 12, 16, 24, 32, 50].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-ink-faint">
                DeepSeek 可开到 50；智谱免费档建议 4。并发越高越吃内存与网络。
              </p>
            </Field>

            <Field label="单张超时（秒）" htmlFor="timeout">
              <Input
                id="timeout"
                type="number"
                min={30}
                max={120}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Number(e.target.value))}
                className="w-32"
              />
            </Field>

            <Field label="最大重试次数" htmlFor="retries">
              <Select value={String(maxRetries)} onValueChange={(v) => setMaxRetries(Number(v))}>
                <SelectTrigger id="retries" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </TabsContent>

          <TabsContent value="about" className="grid gap-2">
            <p className="ps-display text-[15px]">
              {APP_NAME} · v{APP_VERSION}
            </p>
            <p className="text-[12px] text-ink-mid">本地运行，数据保存在浏览器 IndexedDB。</p>
            <p className="text-[12px] text-ink-faint">
              API Key 保存在程序目录的 data/ai-config.json，不会下发到浏览器。
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t border-line/60 pt-4">
          <Button
            variant="ghost"
            className="h-9 rounded-full"
            onClick={() => void handleTest()}
            disabled={testing || saving}
          >
            {testing ? '测试中…' : '测试连接'}
          </Button>
          <Button
            className="h-9 rounded-full px-4"
            onClick={() => void handleSave()}
            disabled={saving || testing}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor} className="ps-eyebrow">
        {label}
      </Label>
      {children}
    </div>
  );
}
