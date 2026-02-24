import type { StudioRenderPayload } from '@/lib/content-studio';

export type RenderEngine = 'satori' | 'playwright';

export interface RenderInput {
  payload: StudioRenderPayload;
}

export interface RenderResult {
  engine: RenderEngine;
  pngBuffer: Buffer;
  pngBase64: string;
  width: number;
  height: number;
  usedFallback: boolean;
}

