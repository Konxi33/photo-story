// src/lib/ai/index.ts
// 浏览器端 AI 出口。绝不 re-export ./server/*，那是 server-only 模块。

export { analyzePhotoLocally, analyzePhotoWithDescription, scorePhotoLocally } from './client';
export { runBatchAnalysis, type BatchAnalyzeOptions } from './client-queue';
