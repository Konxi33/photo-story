// src/config/app.ts
// 全局常量与默认值。改行为优先改这里，不要把魔法数字散落到组件里。

import { DEFAULT_BLOCKS } from '@/lib/export/blocks';
import type { AppSettings, ExportSettings, PhotoErrorCode } from '@/types/domain';

export const APP_NAME = '照片故事' as const;
export const APP_NAME_EN = 'Photo Story' as const;
export const APP_DESCRIPTION = '把照片，写成一册随笔' as const;
export const APP_VERSION = '0.7.6' as const;
export const EXPORT_FILENAME_PREFIX = '照片故事' as const;

export const DEFAULT_CONCURRENCY = 3 as const;
export const MIN_CONCURRENCY = 1 as const;
// 0.6.4：上限从 50 收到 4。所有识别请求都打在本机同一个 Next 服务上，
// 浏览器对同一个域名只开 6 个 HTTP/1.1 连接；并发拉满时，页面自己要用的
// 连接（客户端导航的 RSC 载荷、静态资源）排不上队，就会出现「点项目进不去」
// 「界面像卡死」——实测并发 20 张时拿一次 RSC 载荷要 41 秒。
// 留 2 个连接给界面，识别速度慢一点，但点得动。
export const MAX_CONCURRENCY = 4 as const;

// 0.6.4：实测单张识别（vision + 结构化长文）在 DeepSeek 上要 30–55 秒，
// 原来 60 秒超时太紧，正常的慢请求会被当成「网络中断」记进失败。
export const DEFAULT_TIMEOUT_MS = 90_000 as const;
export const MIN_TIMEOUT_MS = 30_000 as const;
export const MAX_TIMEOUT_MS = 180_000 as const;

export const DEFAULT_MAX_RETRIES = 2 as const;
export const MAX_RETRIES = 3 as const;

export const RETRY_BASE_DELAY_MS = 1_500 as const;
export const RETRY_MAX_DELAY_MS = 4_000 as const;
export const RETRY_JITTER_MS = 400 as const;

export const DEFAULT_TEMPERATURE = 0.7 as const;
export const MIN_TEMPERATURE = 0 as const;
export const MAX_TEMPERATURE = 1 as const;
export const TEMPERATURE_STEP = 0.05 as const;

/**
 * 默认走 DeepSeek（deepseek-flash 支持图片输入）。
 * 输出上限调到 2048：思考模式会占用 completion token，1000 容易被截断。
 * 切回智谱时服务端会自动压到 1024。
 */
export const DEFAULT_MAX_TOKENS = 2048 as const;

/** AI 服务商预设 */
export const AI_PRESETS = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    maxTokens: 2048,
    note: 'deepseek-flash 支持图片，按 token 计费',
    /** 0.5.0：服务端允许较高并发，这里给到 50 */
    maxConcurrency: 50,
  },
  zhipu: {
    label: '智谱',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4v-flash',
    maxTokens: 1000,
    note: 'glm-4v-flash 免费视觉，但有速率限制',
    /** 免费档并发很低，压到 4，避免 429 */
    maxConcurrency: 4,
  },
} as const;

export const DEFAULT_AI_PROVIDER = 'deepseek' as const;
export const DEFAULT_AI_BASE_URL = AI_PRESETS.deepseek.baseURL;
export const DEFAULT_AI_MODEL = AI_PRESETS.deepseek.model;
export const DEFAULT_REASONING = 'off' as const;
export const DEFAULT_IMAGE_DETAIL = 'high' as const;

/**
 * 开源版**不内置任何 API Key**，避免密钥随代码泄漏。
 * 优先级：设置页/配置文件里的 Key > 环境变量 `OPENAI_API_KEY`。
 * 想给自己的构建预置一个 Key，请在本地用 `.env.local`（已被 .gitignore 忽略），
 * 或自己在打包前临时填这个常量——但绝不要提交到仓库。
 */
export const DEFAULT_AI_API_KEY = '' as const;

export const PREVIEW_MAX_EDGE = 640 as const;
export const AI_IMAGE_MAX_EDGE = 1024 as const;

export const DOC_IMAGE_EDGES = {
  standard: 1200,
  high: 1800,
  ultra: 2400,
} as const;

export const COVER_IMAGE_EDGE = 1400 as const;
export const OVERVIEW_THUMB_EDGE = 400 as const;

export const JPEG_QUALITY = 0.85 as const;

export const MB = 1024 * 1024;

export const MAX_UPLOAD_MB = 40 as const;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * MB;

export const MAX_AI_INPUT_MB = 3 as const;
export const MAX_AI_INPUT_BYTES = MAX_AI_INPUT_MB * MB;

export const MAX_IMAGE_PIXELS = 80_000_000 as const;

export const SOFT_SIZE_LIMIT_MB = 25 as const;
export const HARD_SIZE_LIMIT_MB = 40 as const;
export const DOCX_BATCH_HINT_THRESHOLD = 60 as const;

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const AI_ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const DB_NAME = 'photo-story' as const;
export const DB_VERSION = 1 as const;

export const DB_STORES = {
  projects: 'projects',
  photos: 'photos',
  assets: 'assets',
  kv: 'kv',
} as const;

export const ASSET_KEY_SEPARATOR = ':' as const;

export const ORDER_STEP = 1000 as const;

export const STORAGE_KEY_APP_SETTINGS = 'app:settings' as const;
export const STORAGE_KEY_LAST_PROJECT = 'meta:lastProjectId' as const;
export const STORAGE_KEY_SCHEMA_VERSION = 'meta:schemaVersion' as const;
export const STORAGE_KEY_STORAGE_NOTICE = 'meta:storageNoticeDismissed' as const;

export const EDIT_AUTOSAVE_DEBOUNCE_MS = 600 as const;
export const PROGRESS_THROTTLE_MS = 200 as const;
export const TOAST_DURATION_MS = 3500 as const;

export const PHOTO_ERROR_LABELS = {
  UPLOAD_FAILED: '图片读取失败，可能格式不受支持',
  IMAGE_UNSUPPORTED: '当前浏览器无法解码这张图片，建议先转成 JPEG',
  IMAGE_TOO_LARGE: '图片超过 40MB，请先压缩后再上传',
  NO_VISION_SUPPORT: '当前模型不支持图片输入，可改用手动描述模式',
  AI_AUTH: 'API Key 无效或已过期，请到设置中检查',
  AI_RATE_LIMIT: '请求过于频繁，稍后会自动重试',
  AI_TIMEOUT: '识别超时，可重试一次',
  AI_HTTP: '模型服务返回错误，请稍后重试',
  JSON_PARSE: '返回内容不是有效 JSON，可重试',
  SCHEMA_INVALID: '返回字段结构不符合要求，可重试',
  NETWORK: '网络中断，请确认本地服务仍在运行',
  INTERRUPTED: '上次处理被页面刷新中断，可重试',
  CONFIG_MISSING: '尚未配置模型与 API Key，请先完成设置',
  DB_UNAVAILABLE: '浏览器存储不可用，请关闭隐私模式或清理空间后重试',
  EXPORT_FAILED: 'Word 生成失败，请重试或减少导出张数',
  UNKNOWN: '出现未知错误，可查看控制台了解详情',
} as const satisfies Record<PhotoErrorCode, string>;

export const PHOTO_ERROR_RETRYABLE = {
  UPLOAD_FAILED: false,
  IMAGE_UNSUPPORTED: false,
  IMAGE_TOO_LARGE: false,
  NO_VISION_SUPPORT: false,
  AI_AUTH: false,
  AI_RATE_LIMIT: true,
  AI_TIMEOUT: true,
  AI_HTTP: true,
  JSON_PARSE: true,
  SCHEMA_INVALID: true,
  NETWORK: true,
  INTERRUPTED: true,
  CONFIG_MISSING: false,
  DB_UNAVAILABLE: false,
  EXPORT_FAILED: true,
  UNKNOWN: false,
} as const satisfies Record<PhotoErrorCode, boolean>;

export const DEFAULT_EXPORT_SETTINGS = {
  includeCover: true,
  includeOverview: true,
  includeStory: true,
  includeTechnique: true,
  includeTags: true,
  includeMood: false,
  includeAlt: false,
  pageBreakPerPhoto: true,
  layout: 'compact',
  imageQuality: 'high',
  overviewColumns: 3,
  includeSkipped: false,
  showHeader: true,
  orientation: 'portrait',
  margins: 'normal',
  bodyColumns: 1,
  lineSpacing: 1.6,
  showIndex: true,
  paperSize: 'a4',
  gutter: 0,
  captionUnderImage: true,
  captionStyle: 'title',
  includeScoreDetail: false,
  frame: 'none',
  watermark: false,
  watermarkText: 'Xiaomi 14 Ultra',
  watermarkAuthor: '',
  // 0.5.7：默认板块 = 0.5.6 的默认版式（序号/标题/图/图注/正文/拍摄手法/标签）
  blocks: DEFAULT_BLOCKS,
} as const satisfies ExportSettings;

export const DEFAULT_APP_SETTINGS = {
  concurrency: DEFAULT_CONCURRENCY,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxRetries: DEFAULT_MAX_RETRIES,
  aiImageMaxEdge: AI_IMAGE_MAX_EDGE,
  previewMaxEdge: PREVIEW_MAX_EDGE,
  storageNoticeDismissed: false,
} as const satisfies AppSettings;

export const API_ROUTES = {
  analyze: '/api/analyze',
  settings: '/api/settings',
  settingsTest: '/api/settings/test',
} as const;

export const ROUTES = {
  home: '/home',
  projects: '/projects',
  project: (id: string) => '/projects/' + id,
  gallery: '/gallery',
  score: '/score',
  book: '/book',
  flip: '/flip',
  studio: '/studio',
  lab: '/lab',
  themes: '/themes',
  compare: '/compare',
  review: '/review',
  growth: '/growth',
  trash: '/trash',
  changelog: '/changelog',
  settings: '/settings',
} as const;
