import {
  renderStudioPng,
  type StudioRenderPayload,
} from '@/lib/content-studio';
import type { RenderResult } from '@/lib/render/types';

export async function renderWithPlaywright(payload: StudioRenderPayload): Promise<RenderResult> {
  const result = await renderStudioPng(payload);
  return {
    engine: 'playwright',
    pngBuffer: result.pngBuffer,
    pngBase64: result.pngBase64,
    width: result.width,
    height: result.height,
    usedFallback: result.usedFallback,
  };
}

