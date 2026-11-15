// src/app/page.tsx
import { redirect } from 'next/navigation';
import { ROUTES } from '@/config/app';

// 0.5.5：打开软件默认落在「照片故事」主页，而不是项目列表。
// 主页是整本软件的封面：一句招呼、最近的册子、入口三连。
export default function RootPage() {
  redirect(ROUTES.home);
}
