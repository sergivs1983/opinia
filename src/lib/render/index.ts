import type { StudioRenderPayload, StudioTemplateId } from '@/lib/content-studio';
import { renderWithPlaywright } from '@/lib/render/engines/playwright';
import { renderWithSatori } from '@/lib/render/engines/satori';
import type { RenderEngine, RenderResult } from '@/lib/render/types';

export const TEMPLATE_ENGINE: Record<StudioTemplateId, RenderEngine> = {
  'quote-clean': 'satori',
  'feature-split': 'satori',
  'top3-reasons': 'playwright',
  'behind-scenes': 'playwright',
};

function isRenderEngine(value: string | undefined | null): value is RenderEngine {
  return value === 'satori' || value === 'playwright';
}

function resolveEngineOverride(): RenderEngine | null {
  if (process.env.NODE_ENV !== 'test' && process.env.E2E !== '1') return null;
  return isRenderEngine(process.env.RENDER_ENGINE_OVERRIDE) ? process.env.RENDER_ENGINE_OVERRIDE : null;
}

export function resolveRenderEngine(templateId: string | null | undefined): RenderEngine {
  if (!templateId) return 'playwright';
  if (templateId in TEMPLATE_ENGINE) {
    return TEMPLATE_ENGINE[templateId as StudioTemplateId];
  }
  return 'playwright';
}

export async function renderStudioWithEngine(payload: StudioRenderPayload): Promise<RenderResult> {
  const preferredEngine = resolveEngineOverride() || resolveRenderEngine(payload.template_id);

  if (preferredEngine === 'satori') {
    try {
      return await renderWithSatori(payload);
    } catch {
      const fallback = await renderWithPlaywright(payload);
      return {
        ...fallback,
        usedFallback: true,
      };
    }
  }

  return renderWithPlaywright(payload);
}

export type { RenderEngine, RenderResult } from '@/lib/render/types';

