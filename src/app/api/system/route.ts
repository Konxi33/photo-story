import 'server-only';

import { NextResponse } from 'next/server';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const dynamic = 'force-dynamic';

/** 只读系统信息：数据目录、平台、版本，供设置页展示 */
export function GET(): NextResponse {
  return NextResponse.json(
    {
      dataDir: process.env.PHOTO_STORY_DATA_DIR ?? '',
      platform: process.platform,
      node: process.version,
    },
    { headers: NO_STORE },
  );
}
