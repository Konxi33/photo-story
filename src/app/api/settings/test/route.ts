import 'server-only';

import { NextResponse } from 'next/server';

import { AiServiceError, createClient, readAiConfig } from '@/lib/ai/server';
import type { SettingsTestResponse } from '@/types/domain';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse<SettingsTestResponse>> {
  const startedAt = Date.now();

  try {
    const config = await readAiConfig();
    const client = createClient(config);

    await client.chat.completions.create(
      {
        model: config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      },
      { signal: AbortSignal.timeout(15000) },
    );

    return NextResponse.json(
      {
        ok: true,
        latencyMs: Date.now() - startedAt,
        model: config.model,
        message: '连接正常',
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    const message =
      error instanceof AiServiceError
        ? error.message
        : error instanceof Error
          ? error.message
          : '连接失败';
    return NextResponse.json(
      { ok: false, message, latencyMs: Date.now() - startedAt },
      { headers: NO_STORE },
    );
  }
}
