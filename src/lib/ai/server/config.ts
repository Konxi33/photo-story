// src/lib/ai/server/config.ts
import 'server-only';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_AI_API_KEY,
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  DEFAULT_IMAGE_DETAIL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REASONING,
  DEFAULT_TEMPERATURE,
} from '@/config/app';
import type {
  AiConfigPublic,
  AiProvider,
  ImageDetailLevel,
  PhotoErrorCode,
  ReasoningLevel,
  SettingsUpdateRequest,
} from '@/types/domain';

export interface AiConfigInternal {
  provider: AiProvider;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  visionEnabled: boolean;
  reasoning: ReasoningLevel;
  imageDetail: ImageDetailLevel;
  apiKey: string;
  updatedAt: number;
}

export class AiServiceError extends Error {
  readonly code: PhotoErrorCode;
  readonly httpStatus?: number;

  constructor(code: PhotoErrorCode, message: string, httpStatus?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AiServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// 打包成 portable exe 后，程序每次运行会解压到临时目录，
// 因此配置必须写到 Electron 传来的固定目录（用户数据目录），否则每次启动都要重填 Key。
const DATA_DIR = process.env.PHOTO_STORY_DATA_DIR || path.join(process.cwd(), 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'ai-config.json');

type RawConfig = Partial<AiConfigInternal>;

/** 智谱的 glm-4v-flash 上限是 1024，超过会 400 */
function clampMaxTokens(provider: AiProvider, baseURL: string, value: number): number {
  const isZhipu = provider === 'zhipu' || baseURL.includes('bigmodel.cn');
  if (isZhipu) return Math.min(1024, Math.max(64, Math.round(value)));
  return Math.min(8192, Math.max(256, Math.round(value)));
}

function guessProvider(baseURL: string): AiProvider {
  if (!baseURL) return DEFAULT_AI_PROVIDER;
  if (baseURL.includes('bigmodel.cn')) return 'zhipu';
  if (baseURL.includes('deepseek.com')) return 'deepseek';
  return 'custom';
}

async function readRaw(): Promise<RawConfig> {
  try {
    const text = await readFile(CONFIG_PATH, 'utf8');
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as RawConfig) : {};
  } catch {
    return {};
  }
}

async function writeRaw(next: RawConfig): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

/**
 * 老配置迁移（0.3.3 之前默认是智谱）：
 * 文件里没有 provider 且 baseURL 指向智谱时，切换到 DeepSeek 默认，
 * 并清空旧 Key（智谱的 Key 在 DeepSeek 上必然 401，留着只会让人困惑）。
 */
async function ensureMigrated(raw: RawConfig): Promise<RawConfig> {
  if (raw.provider) return raw;

  const baseURL = (raw.baseURL ?? '').trim();
  if (!baseURL) return raw;

  const provider = guessProvider(baseURL);
  if (provider === 'zhipu') {
    const migrated: RawConfig = {
      provider: 'deepseek',
      baseURL: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: raw.temperature ?? DEFAULT_TEMPERATURE,
      reasoning: DEFAULT_REASONING,
      imageDetail: DEFAULT_IMAGE_DETAIL,
      visionEnabled: true,
      apiKey: '',
      updatedAt: Date.now(),
    };
    await writeRaw(migrated);
    return migrated;
  }

  const patched: RawConfig = { ...raw, provider, updatedAt: Date.now() };
  await writeRaw(patched);
  return patched;
}

function fromEnv(): RawConfig {
  const temperature = Number(process.env.AI_TEMPERATURE);
  return {
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.AI_MODEL,
    temperature: Number.isFinite(temperature) ? temperature : undefined,
  };
}

/** 依优先级取第一个非空字符串（文件 > 环境变量 > 内置默认 Key） */
function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalize(raw: RawConfig): AiConfigInternal {
  const baseURL = (raw.baseURL ?? '').trim().replace(/\/+$/, '');
  const model = (raw.model ?? '').trim();
  const apiKey = (raw.apiKey ?? '').trim();
  const provider = raw.provider ?? guessProvider(baseURL);

  if (!baseURL || !model || !apiKey) {
    throw new AiServiceError(
      'CONFIG_MISSING',
      '尚未配置模型与 API Key，请到设置中填写后重试',
      400,
    );
  }

  return {
    provider,
    baseURL,
    model,
    temperature: typeof raw.temperature === 'number' ? raw.temperature : DEFAULT_TEMPERATURE,
    maxTokens: clampMaxTokens(
      provider,
      baseURL,
      typeof raw.maxTokens === 'number' ? raw.maxTokens : DEFAULT_MAX_TOKENS,
    ),
    visionEnabled: raw.visionEnabled ?? true,
    reasoning: raw.reasoning ?? DEFAULT_REASONING,
    imageDetail: raw.imageDetail ?? DEFAULT_IMAGE_DETAIL,
    apiKey,
    updatedAt: raw.updatedAt ?? Date.now(),
  };
}

export async function readAiConfig(): Promise<AiConfigInternal> {
  const file = await ensureMigrated(await readRaw());
  const env = fromEnv();
  return normalize({
    provider: file.provider,
    baseURL: file.baseURL ?? env.baseURL,
    apiKey: firstNonEmpty(file.apiKey, env.apiKey, DEFAULT_AI_API_KEY),
    model: file.model ?? env.model,
    temperature: file.temperature ?? env.temperature,
    maxTokens: file.maxTokens,
    visionEnabled: file.visionEnabled,
    reasoning: file.reasoning,
    imageDetail: file.imageDetail,
    updatedAt: file.updatedAt,
  });
}

export async function writeAiConfig(patch: SettingsUpdateRequest): Promise<void> {
  const current = await ensureMigrated(await readRaw());
  const next: RawConfig = { ...current };

  if (patch.provider !== undefined) next.provider = patch.provider;
  if (patch.baseURL !== undefined) next.baseURL = patch.baseURL.trim().replace(/\/+$/, '');
  if (patch.model !== undefined) next.model = patch.model.trim();
  if (patch.temperature !== undefined) next.temperature = patch.temperature;
  if (patch.reasoning !== undefined) next.reasoning = patch.reasoning;
  if (patch.imageDetail !== undefined) next.imageDetail = patch.imageDetail;
  if (patch.visionEnabled !== undefined) next.visionEnabled = patch.visionEnabled;

  if (patch.maxTokens !== undefined) {
    next.maxTokens = clampMaxTokens(
      next.provider ?? DEFAULT_AI_PROVIDER,
      next.baseURL ?? '',
      patch.maxTokens,
    );
  }

  if (patch.apiKey !== undefined) {
    const key = patch.apiKey.trim();
    if (key) next.apiKey = key;
    else delete next.apiKey;
  }

  next.updatedAt = Date.now();
  await writeRaw(next);
}

export async function getPublicConfig(): Promise<AiConfigPublic> {
  const file = await ensureMigrated(await readRaw());
  const env = fromEnv();

  const apiKey = firstNonEmpty(file.apiKey, env.apiKey, DEFAULT_AI_API_KEY) ?? '';
  const baseURL = (file.baseURL ?? env.baseURL ?? '').trim().replace(/\/+$/, '');
  const model = (file.model ?? env.model ?? '').trim();
  const temperature =
    typeof file.temperature === 'number'
      ? file.temperature
      : typeof env.temperature === 'number'
        ? env.temperature
        : DEFAULT_TEMPERATURE;

  const provider = file.provider ?? guessProvider(baseURL);

  const source =
    file.apiKey && file.apiKey.trim()
      ? ('file' as const)
      : env.apiKey && env.apiKey.trim()
        ? ('env' as const)
        : apiKey
          ? ('builtin' as const)
          : ('none' as const);

  return {
    provider,
    baseURL: baseURL || DEFAULT_AI_BASE_URL,
    model: model || DEFAULT_AI_MODEL,
    temperature,
    maxTokens: clampMaxTokens(
      provider,
      baseURL,
      file.maxTokens ?? DEFAULT_MAX_TOKENS,
    ),
    visionEnabled: file.visionEnabled ?? true,
    reasoning: file.reasoning ?? DEFAULT_REASONING,
    imageDetail: file.imageDetail ?? DEFAULT_IMAGE_DETAIL,
    hasKey: Boolean(apiKey),
    keyHint: apiKey ? `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}` : null,
    keySource: source,
    updatedAt: file.updatedAt ?? Date.now(),
  };
}
