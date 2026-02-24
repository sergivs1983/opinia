import { ImageResponse } from '@vercel/og';
import {
  getStudioDimensions,
  type StudioRenderPayload,
} from '@/lib/content-studio';
import { renderSatoriTemplate, isSatoriTemplate } from '@/lib/render/templates/satori';
import type { RenderResult } from '@/lib/render/types';

export async function renderWithSatori(payload: StudioRenderPayload): Promise<RenderResult> {
  if (!isSatoriTemplate(payload.template_id)) {
    throw new Error(`template_not_supported_by_satori:${payload.template_id}`);
  }

  const { width, height } = getStudioDimensions(payload.format);
  const element = renderSatoriTemplate(payload, width, height);
  const image = new ImageResponse(element, { width, height });
  const buffer = Buffer.from(await image.arrayBuffer());

  if (buffer.byteLength === 0) {
    throw new Error('satori_render_empty_buffer');
  }

  return {
    engine: 'satori',
    pngBuffer: buffer,
    pngBase64: buffer.toString('base64'),
    width,
    height,
    usedFallback: false,
  };
}

