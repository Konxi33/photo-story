import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getPublicConfig, writeAiConfig } from '@/lib/ai/server';
import type { AiConfigPublic } from '@/types/domain';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<AiConfigPublic>> {
  return NextResponse.json(await getPublicConfig(), { headers: NO_STORE });
}

const SettingsPatchSchema = z
  .object({
    provider: z.enum(['deepseek', 'zhipu', 'custom']).optional(),
    baseURL: z.string().url().max(300).optional(),
    model: z.string().min(1).max(120).optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(64).max(8192).optional(),
    visionEnabled: z.boolean().optional(),
    reasoning: z.enum(['off', 'low', 'high']).optional(),
    imageDetail: z.enum(['low', 'high']).optional(),
    apiKey: z.string().max(400).optional(),
  })
  .strict();

export async function PUT(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: '请求体不是合法 JSON' },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = SettingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        ok: false,
        message: first ? first.path.join('.') + '：' + first.message : '参数不合法',
      },
      { status: 400, headers: NO_STORE },
    );
  }

  await writeAiConfig(parsed.data);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
