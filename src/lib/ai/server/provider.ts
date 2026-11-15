import 'server-only';

import OpenAI from 'openai';

import {
  PROMPT_JSON_SCHEMA,
  PROMPT_JSON_SCHEMA_NAME,
  SYSTEM_PROMPT,
  buildAnalyzePrompt,
} from '@/config/prompts';
import {
  SCORE_JSON_SCHEMA,
  SCORE_JSON_SCHEMA_NAME,
  SCORE_USER_PROMPT,
  buildJudgeSystemPrompt,
  type JudgeId,
} from '@/config/scorePrompt';
import type { AnalyzeStyleOptions, AnalyzeUsage, ResponseFormatMode } from '@/types/domain';

import { AiServiceError, type AiConfigInternal } from './config';

export interface AnalyzeImageParams {
  config: AiConfigInternal;
  imageBase64?: string;
  mimeType?: string;
  userDescription?: string;
  timeoutMs?: number;
  /** 标题/叙事/字数风格与同批已用标题 */
  style?: AnalyzeStyleOptions;
  /** 'full' 整篇生成（默认）/ 'score' 只评分 */
  mode?: 'full' | 'score';
  /** 评审室：指定评委身份，只对 mode='score' 生效 */
  judge?: JudgeId;
}

export interface AnalyzeImageResult {
  raw: string;
  usage?: AnalyzeUsage;
  latencyMs: number;
  model: string;
  temperature: number;
  responseFormat: ResponseFormatMode;
}

export function createClient(config: AiConfigInternal): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 30000,
    maxRetries: 0,
  });
}

/**
 * DeepSeek 思考模式参数：
 *   off  → 关闭思考（最省，批量生成用这个）
 *   low  → 开启 + 低强度
 *   high → 开启 + 高强度（评分/复杂判断用）
 * 只有 DeepSeek 端点才发送，其他服务商不认识这些字段会 400。
 */
function thinkingParams(config: AiConfigInternal): Record<string, unknown> {
  const isDeepSeek =
    config.provider === 'deepseek' || config.baseURL.includes('api.deepseek.com');
  if (!isDeepSeek) return {};

  if (config.reasoning === 'off') {
    return { thinking: { type: 'disabled' } };
  }
  return {
    thinking: { type: 'enabled' },
    reasoning_effort: config.reasoning === 'high' ? 'high' : 'low',
  };
}

function buildResponseFormat(
  mode: ResponseFormatMode,
  schema: Record<string, unknown>,
  schemaName: string,
): Record<string, unknown> | undefined {
  if (mode === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema,
      },
    };
  }
  if (mode === 'json_object') return { type: 'json_object' };
  return undefined;
}

/**
 * 是否应该降级 response_format。
 * 智谱等国内厂商对不支持的参数返回中文 400 报错，关键词匹配抓不到，
 * 所以放宽为「400 一律降级」：降级不会更糟，最坏情况是三级都失败后报原始错误。
 */
function isFormatUnsupported(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  return error.status === 400;
}

function mapUpstreamError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) return error;

  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    if (status === 401 || status === 403) {
      return new AiServiceError('AI_AUTH', 'API Key 无效或已过期，请到设置中检查', status, error);
    }
    if (status === 429) {
      return new AiServiceError('AI_RATE_LIMIT', '请求过于频繁，稍后会自动重试', status, error);
    }
    if (status === 408 || status === 504) {
      return new AiServiceError('AI_TIMEOUT', '识别超时，可重试一次', status, error);
    }
    return new AiServiceError(
      'AI_HTTP',
      '模型服务返回错误（' + (status || '未知') + '）',
      status,
      error,
    );
  }

  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new AiServiceError('AI_TIMEOUT', '识别超时，可重试一次', 504, error);
  }

  return new AiServiceError('AI_HTTP', '调用模型服务失败', 502, error);
}

export async function analyzeImage(params: AnalyzeImageParams): Promise<AnalyzeImageResult> {
  const { config, imageBase64, mimeType } = params;
  const timeoutMs = params.timeoutMs ?? 60000;
  const scoreOnly = params.mode === 'score';

  const promptText = scoreOnly
    ? SCORE_USER_PROMPT
    : buildAnalyzePrompt({
        hasImage: Boolean(imageBase64),
        userDescription: params.userDescription,
        style: params.style,
      });
  const systemPrompt = scoreOnly
    ? buildJudgeSystemPrompt(params.judge)
    : SYSTEM_PROMPT;
  const jsonSchema = scoreOnly ? SCORE_JSON_SCHEMA : PROMPT_JSON_SCHEMA;
  const jsonSchemaName = scoreOnly ? SCORE_JSON_SCHEMA_NAME : PROMPT_JSON_SCHEMA_NAME;

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = imageBase64
    ? [
        { type: 'text', text: promptText },
        {
          type: 'image_url',
          image_url: {
            url: 'data:' + (mimeType ?? 'image/jpeg') + ';base64,' + imageBase64,
            // low = 缩到 512×512（省 token），high = 保留原图（识别更准）
            detail: config.imageDetail,
          },
        },
      ]
    : [{ type: 'text', text: promptText }];

  const client = createClient(config);
  const modes: ResponseFormatMode[] = ['json_schema', 'json_object', 'text'];
  const startedAt = Date.now();

  let lastError: unknown = null;

  for (const mode of modes) {
    try {
      // 思考模式会吃掉 completion token，导致 content 为空；
      // 这里先按当前设置请求，空内容就自动关思考重试一次。
      let thinkingEnabled = config.reasoning !== 'off';
      let completion: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const effectiveConfig = thinkingEnabled
          ? config
          : { ...config, reasoning: 'off' as const };

        completion = await client.chat.completions.create(
          {
            model: config.model,
            temperature: config.temperature,
            // 开思考时预留额外空间，避免正文被思考挤没
            max_tokens: thinkingEnabled
              ? Math.max(config.maxTokens, 4096)
              : config.maxTokens,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            response_format: buildResponseFormat(mode, jsonSchema, jsonSchemaName) as never,
            // DeepSeek 的思考模式开关与强度（其他服务商不发送，避免 400）
            ...thinkingParams(effectiveConfig),
          },
          { signal: AbortSignal.timeout(timeoutMs) },
        );

        const text = completion.choices[0]?.message?.content ?? '';
        if (text.trim()) break;

        if (thinkingEnabled) {
          thinkingEnabled = false;
          continue;
        }
        throw new AiServiceError('AI_HTTP', '模型返回了空内容', 502);
      }

      const raw = completion?.choices[0]?.message?.content ?? '';
      if (!raw.trim()) throw new AiServiceError('AI_HTTP', '模型返回了空内容', 502);

      return {
        raw,
        usage: {
          promptTokens: completion?.usage?.prompt_tokens,
          completionTokens: completion?.usage?.completion_tokens,
          totalTokens: completion?.usage?.total_tokens,
        },
        latencyMs: Date.now() - startedAt,
        model: completion?.model || config.model,
        temperature: config.temperature,
        responseFormat: mode,
      };
    } catch (error) {
      lastError = error;
      if (mode !== 'text' && isFormatUnsupported(error)) continue;
      throw mapUpstreamError(error);
    }
  }

  throw mapUpstreamError(lastError);
}
