// src/types/domain.ts
// 领域模型：浏览器与服务端共用的纯类型，不含任何运行时依赖。

// 0.5.7：板块 id 定义在导出模块里，这里只用类型，避免运行时循环依赖。
import type { PhotoBlockId } from '@/lib/export/blocks';

export const DOMAIN_SCHEMA_VERSION = 1 as const;

export type PhotoStatus = 'idle' | 'processing' | 'success' | 'failed';
export type AnalysisSource = 'vision' | 'manual-description' | 'manual-edit';
export type ImageQuality = 'standard' | 'high' | 'ultra';
export type LayoutMode = 'compact' | 'loose';
export type AssetVariant = 'original' | 'preview' | 'ai' | 'doc';

/** 标题风格 */
export type TitleStyle =
  | 'literary' // 文学意象
  | 'concise' // 四字凝练
  | 'poetic' // 诗性对仗
  | 'cinematic' // 电影片名
  | 'plain' // 朴素纪实
  | 'symbol'; // 隐喻象征

/** 叙事风格 */
export type NarrativeStyle =
  | 'essay' // 照片随笔
  | 'documentary' // 冷静纪实
  | 'prose-poem' // 散文诗
  | 'diary' // 日记体
  | 'terse'; // 短句硬朗

/** 故事字数档位 */
export type StoryLength = 'short' | 'medium' | 'long';

/** 生成风格选项（随请求下发，不落库到项目） */
export interface AnalyzeStyleOptions {
  titleStyle?: TitleStyle;
  narrativeStyle?: NarrativeStyle;
  storyLength?: StoryLength;
  /** 同批次已用标题，要求模型避开重复 */
  existingTitles?: string[];
  /**
   * 0.5.7：这一页最终会印成什么样（由导出板块推导）。
   * 文案要跟着版面走 —— 极简画册只有一行图注，就不该产出 200 字正文。
   */
  pageHint?: string;
}


export type PhotoErrorCode =
  | 'UPLOAD_FAILED'
  | 'IMAGE_UNSUPPORTED'
  | 'IMAGE_TOO_LARGE'
  | 'NO_VISION_SUPPORT'
  | 'AI_AUTH'
  | 'AI_RATE_LIMIT'
  | 'AI_TIMEOUT'
  | 'AI_HTTP'
  | 'JSON_PARSE'
  | 'SCHEMA_INVALID'
  | 'NETWORK'
  | 'INTERRUPTED'
  | 'CONFIG_MISSING'
  | 'DB_UNAVAILABLE'
  | 'EXPORT_FAILED'
  | 'UNKNOWN';

export interface Technique {
  composition: string;
  lighting: string;
  color: string;
  lens: string;
  post: string;
}

/** 0.3.1：拍摄参数（模型推断，可编辑） */
export interface ShootingParams {
  /** 等效焦段，例如 23mm */
  focalLength: string;
  /** 光圈，例如 f/1.8 */
  aperture: string;
  /** 快门，例如 1/125s */
  shutter: string;
  /** 感光度，例如 ISO 100 */
  iso: string;
  /** 调色风格，例如 徕卡经典 · 低饱和偏冷 */
  colorGrade: string;
}

export interface PhotoAnalysis {
  title: string;
  story: string;
  technique: Technique;
  tags: string[];
  mood: string;
  alt: string;
  /** 0.3.1 新增（旧数据可缺失） */
  params?: ShootingParams;
  /** 为什么好看：2–3 条短句 */
  whyGood?: string[];
  /** 提升建议：1–2 条 */
  improve?: string[];
  /** 模仿建议：1–2 条 */
  imitate?: string[];
  /** 0.3.2 评分与优化建议 */
  score?: PhotoScore;
  scoreAdvice?: string[];
}

/** 0.3.2：评分小项（0–100，保留一位小数） */
export interface ScoreBreakdown {
  composition: number;
  lighting: number;
  color: number;
  subject: number;
  timing: number;
  technique: number;
}

/** 0.3.2：100 分制评分 */
export interface PhotoScore {
  overall: number;
  breakdown: ScoreBreakdown;
}

export interface AnalysisMeta {
  model: string;
  promptVersion: string;
  temperature: number;
  source: AnalysisSource;
  createdAt: number;
  updatedAt: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
  warnings?: string[];
}

export interface PhotoError {
  code: PhotoErrorCode;
  message: string;
  raw?: string;
  attempts?: number;
  retryable: boolean;
  at: number;
}

export interface Photo {
  id: string;
  projectId: string;
  order: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  status: PhotoStatus;
  selected: boolean;
  isEdited: boolean;
  analysis?: PhotoAnalysis;
  meta?: AnalysisMeta;
  error?: PhotoError;
  createdAt: number;
  updatedAt: number;
  /** 0.4.2：完整拍摄参数（相机/镜头/光圈/快门/ISO/焦距） */
  exif?: import('@/lib/image/exif').ExifInfo;
  /** 0.3.1：拍摄时间（EXIF DateTimeOriginal，读不到时用文件修改时间） */
  takenAt?: number;
  /** 0.5.6：软删除时间戳。有值即在回收站里，列表/导出/统计默认都不再算它。 */
  deletedAt?: number;
}

export type PhotoAnalysisPatch = Partial<Omit<PhotoAnalysis, 'technique'>> & {
  technique?: Partial<Technique>;
};

export interface ExportSettings {
  includeCover: boolean;
  coverPhotoId?: string;
  includeOverview: boolean;
  includeStory: boolean;
  includeTechnique: boolean;
  includeTags: boolean;
  includeMood: boolean;
  includeAlt: boolean;
  pageBreakPerPhoto: boolean;
  layout: LayoutMode;
  imageQuality: ImageQuality;
  overviewColumns: 2 | 3;
  includeSkipped: boolean;
  showHeader: boolean;
  /** 0.3.0 新增：更多排版自定义 */
  orientation: 'portrait' | 'landscape';
  margins: 'narrow' | 'normal' | 'wide';
  bodyColumns: 1 | 2;
  lineSpacing: 1.4 | 1.6 | 1.8;
  showIndex: boolean;
  /** 0.5.4：面向打印的纸张与装订*/
  paperSize: 'a4' | 'a5';
  /** 装订线宽度（cm），左侧额外留白 */
  gutter: 0 | 0.5 | 1;
  /** 图片下方是否印一行器材与曝光参数 */
  captionUnderImage: boolean;
  /**
   * 0.5.5：图注写什么。
   *   title —— 编号 + 标题（摄影集常规做法，参数移进书末技术附录）
   *   param —— 编号 + 器材参数（技术流画册）
   *   both  —— 编号 + 标题 + 参数（信息最全，但一行偏长）
   */
  captionStyle: 'title' | 'param' | 'both';
  /**
   * 0.5.4：是否印「参数表 + 评分卡 + 三块建议」这一整块解读内容。
   * 默认关掉 —— 它占掉整页一半高度，开着的话图只能缩到 6~8cm，
   * 打印出来像图表报告；关掉后每页一张大图，才像摄影集。
   */
  includeScoreDetail: boolean;
  /** 0.3.1：相框与水印 */
  frame: FrameStyle;
  watermark: boolean;
  watermarkText?: string;
  watermarkAuthor?: string;
  /**
   * 0.5.7：照片页里各板块的顺序（用户拖出来的就是它）。
   * 不填时由旧的布尔开关推导（见 src/lib/export/blocks.ts 的 resolveBlocks），
   * 所以老项目升级上来版式不会变。
   */
  blocks?: PhotoBlockId[];
  /** 0.5.7：上次套用的模板 id，UI 用来显示「当前是摄影集模板」 */
  templateId?: string;
  /**
   * 0.6.0：一页照片的「积木排版」（12 列 × 24 行的网格）。
   * 有它就按它画，没有则由 blocks/旧开关推导成竖排（老项目升级版式不变）。
   * 名字避开了 layout（那是排版密度 compact/loose）。
   */
  grid?: import('@/lib/export/layout').PageLayout;
  /**
   * 这一次导出要不要按 grid 画（默认 true）。用户在导出对话框里关掉
   * 「按排版台的位置印」时写 false——grid 本身仍保留，不会被清掉。
   */
  useGrid?: boolean;
}

/** 相框样式 */
export type FrameStyle = 'none' | 'white' | 'leica' | 'film';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  coverPhotoId?: string;
  exportSettings: ExportSettings;
  schemaVersion: number;
}

export interface AppSettings {
  lastExportSettings?: ExportSettings;
  concurrency: number;
  timeoutMs: number;
  maxRetries: number;
  aiImageMaxEdge: number;
  previewMaxEdge: number;
  storageNoticeDismissed: boolean;

  /** 0.3.0：生成风格默认值 */
  titleStyle?: TitleStyle;
  narrativeStyle?: NarrativeStyle;
  storyLength?: StoryLength;

  /** 0.3.0：外观与照片墙 */
  theme?: 'paper' | 'warm' | 'cool' | 'dark';
  backgroundBlur?: number; // 0-24 px
  animations?: boolean;
  wallColumns?: 2 | 3 | 4 | 5;
  wallView?: 'grid' | 'wall';

  /** 0.3.0：上传策略 */
  compressOnUpload?: boolean;
  keepOriginal?: boolean;

  /** 0.3.1：外观与照片库 */
  darkMode?: boolean;
  glass?: boolean;
  /** 0.3.4：主题模式（跟随系统 / 浅色 / 深色） */
  themeMode?: ThemeMode;
  /** 0.3.4：字体方案 */
  fontFamily?: FontFamily;
  hoverLift?: boolean;
  gallerySort?: 'added' | 'taken';
  gallerySortDir?: 'asc' | 'desc';
  galleryColumns?: 3 | 4 | 5 | 6;
  /** 0.3.6：照片库是否显示日期分组 */
  galleryShowDates?: boolean;
  /** 0.3.6：左侧功能栏模式 */
  sidebarMode?: 'always' | 'hover';
  /** 0.4.0：常驻模式下折叠为图标栏 */
  sidebarCollapsed?: boolean;
  /** 0.4.0：评分引擎，ai=模型主观，local=本地像素 */
  scoreEngine?: 'ai' | 'local';
  defaultFrame?: FrameStyle;
  /** 0.3.2：玻璃模糊强度（px） */
  glassBlur?: number;
  /** 0.5.4：固定的导出目录（空 = 每次导出由系统询问位置） */
  exportDir?: string;
  /** 0.5.4：导出完成后是否在资源管理器中选中文件 */
  revealAfterExport?: boolean;
  /** 0.5.7：启动时是否自动检查新版本（默认开） */
  autoCheckUpdates?: boolean;
}

/** AI 服务商预设 */
export type AiProvider = 'deepseek' | 'zhipu' | 'custom';

/** 推理强度：off 最省，high 最准 */
export type ReasoningLevel = 'off' | 'low' | 'high';

/** 图片细节：low 缩到 512（省 token），high 保留原图 */
export type ImageDetailLevel = 'low' | 'high';

/** 0.3.4：主题模式 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** 0.3.4：字体方案 */
export type FontFamily = 'round' | 'system' | 'song';

export interface AiConfigPublic {
  provider: AiProvider;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  visionEnabled: boolean;
  reasoning: ReasoningLevel;
  imageDetail: ImageDetailLevel;
  hasKey: boolean;
  keyHint: string | null;
  keySource: 'file' | 'env' | 'builtin' | 'none';
  updatedAt: number;
}

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';
export type ResponseFormatMode = 'json_schema' | 'json_object' | 'text';

export interface AnalyzeRequest {
  photoId: string;
  imageBase64?: string;
  mimeType?: ImageMimeType;
  userDescription?: string;
  promptVersion?: string;
  /** 0.3.0：风格与去重信息 */
  style?: AnalyzeStyleOptions;
}

export interface AnalyzeUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AnalyzeResponseMeta {
  model: string;
  promptVersion: string;
  temperature: number;
  latencyMs: number;
  responseFormat: ResponseFormatMode;
  warnings: string[];
}

export interface AnalyzeResponse {
  ok: true;
  analysis: PhotoAnalysis;
  meta: AnalyzeResponseMeta;
  usage?: AnalyzeUsage;
}

export interface AnalyzeErrorResponse {
  ok: false;
  error: PhotoError;
}

export type AnalyzeResult = AnalyzeResponse | AnalyzeErrorResponse;

/** 0.3.2：只要评分的响应 */
export interface ScoreResponse {
  ok: true;
  score: PhotoScore;
  scoreAdvice: string[];
  meta: AnalyzeResponseMeta;
  usage?: AnalyzeUsage;
}

export type ScoreResult = ScoreResponse | AnalyzeErrorResponse;

export interface SettingsUpdateRequest {
  provider?: AiProvider;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  visionEnabled?: boolean;
  reasoning?: ReasoningLevel;
  imageDetail?: ImageDetailLevel;
  apiKey?: string;
}

export interface SettingsTestResponse {
  ok: boolean;
  latencyMs?: number;
  model?: string;
  message?: string;
}

export type UploadStage = 'decoding' | 'deriving' | 'persisting' | 'done' | 'failed';

export interface UploadTask {
  id: string;
  fileName: string;
  stage: UploadStage;
  progress: number;
  error?: PhotoError;
}

export interface BatchRunSummary {
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  skipped: number;
  startedAt: number;
  finishedAt: number;
}

export type BatchRunStatus = 'idle' | 'running' | 'stopping' | 'finished';

export interface BatchRunState {
  status: BatchRunStatus;
  done: number;
  total: number;
  summary?: BatchRunSummary;
}

export type ExportStage =
  | 'collecting'
  | 'encoding'
  | 'rendering'
  | 'packing'
  | 'done'
  | 'failed';

export interface ExportProgress {
  stage: ExportStage;
  current: number;
  total: number;
  message: string;
  detail?: string;
}

export interface ExportError {
  code: PhotoErrorCode;
  message: string;
  raw?: string;
}

export interface ExportResult {
  ok: boolean;
  fileName?: string;
  bytes?: number;
  photoCount?: number;
  durationMs?: number;
  skippedCount?: number;
  downgraded?: boolean;
  /** 0.5.4：固定导出目录下保存的完整路径（Desktop 才有） */
  filePath?: string;
  error?: ExportError;
}

export type ExportTaskStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface ExportTaskState {
  status: ExportTaskStatus;
  progress: ExportProgress | null;
  result?: ExportResult;
}

export interface AssetRecord {
  /** \`\${photoId}:\${variant}\` */
  key: string;
  photoId: string;
  variant: AssetVariant;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  coverPhotoId?: string;
  photoCount: number;
  successCount: number;
  failedCount: number;
}

export interface StorageUsage {
  usage: number;
  quota: number;
  persisted: boolean;
}

export interface ProjectBackup {
  kind: 'photo-story-backup';
  schemaVersion: number;
  exportedAt: number;
  project: Project;
  photos: Array<{
    photo: Photo;
    assets: Partial<Record<AssetVariant, { mime: string; base64: string }>>;
  }>;
}
