/**
 * Generate one image from a saved image provider, to prove the whole path.
 *
 * POST /api/provider/test-image-generation
 *
 * Body: { provider, model?, prompt?, aspectRatio? }
 * Response: { success, message, imageUrl?, ms, model, providerId } or an error.
 *
 * Settings offer two different questions, and they need two different answers:
 *
 * - "Is it configured?" is a connectivity probe
 *   (`/api/verify-image-provider`): cheap, never generates, never bills.
 * - "Does it actually work?" cannot be answered without generating. A relay can
 *   answer its model catalogue perfectly and still fail every generation — a
 *   model id it does not serve, a quota, a request shape it does not accept —
 *   and no probe can tell. So this route is honest about what it is: it spends
 *   one real generation, and the UI says so before the click.
 *
 * It runs the *same* step as a real course generation (`generateImageStep`), so
 * what it proves is what production does: same model resolution, same sizing,
 * same transport policy, same usage accounting. A bespoke request built just for
 * the test would answer a question nobody asked.
 *
 * Provider resolution is the workspace's own saved provider, by id
 * (`savedMediaConnection`): the server reads the stored endpoint and key, so no
 * credentials travel through the browser, and the endpoint runs under the same
 * validation a real generation gives it.
 */

import { NextRequest } from 'next/server';

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import {
  savedMediaConnection,
  savedProviderRef,
  savedProviderResponse,
} from '@/lib/server/model-config/saved-provider';
import { generateImageStep } from '@/lib/server/generation/steps/image';
import { StepRefusal, type StepContext } from '@/lib/server/generation/steps/context';
import type { ImageGenerationOptions } from '@/lib/media/types';

const log = createLogger('TestImageGeneration');

/** Generous enough for a slow model, short enough to answer a stuck request. */
const GENERATION_TIMEOUT_MS = 120_000;

/**
 * The largest inline image the response carries. A base64 data URL is ~4/3 of
 * the bytes, and the whole thing is serialized into one JSON body, so a very
 * large PNG is reported as a success without a preview rather than dropped by a
 * body limit with a confusing error.
 */
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

const ASPECT_RATIOS = ['16:9', '4:3', '1:1', '9:16'] as const;

/** The default prompt, so the button works with nothing typed. */
const DEFAULT_PROMPT =
  'A futuristic Vietnamese city at night, neon lights, cinematic, highly detailed';

interface TestGenerationBody {
  provider?: unknown;
  model?: unknown;
  prompt?: unknown;
  aspectRatio?: unknown;
}

/** The image to show, or undefined when it is too large to inline. */
function inlineImage(result: {
  url?: string;
  base64?: string;
  mimeType?: string;
}): string | undefined {
  if (result.base64) {
    if (result.base64.length > MAX_INLINE_BYTES) return undefined;
    return `data:${result.mimeType ?? 'image/png'};base64,${result.base64}`;
  }
  return result.url;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as TestGenerationBody | null;
    if (!body || typeof body !== 'object') {
      return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
    }

    let connection;
    try {
      const ref = savedProviderRef(body.provider, body.model);
      if (!ref) return apiError('MISSING_PROVIDER', 400, 'No image provider named');
      connection = await savedMediaConnection(request, 'image', ref);
    } catch (error) {
      const refused = savedProviderResponse(error, 'image');
      if (refused) return refused;
      throw error;
    }

    const prompt =
      typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : DEFAULT_PROMPT;
    const aspectRatio =
      typeof body.aspectRatio === 'string' &&
      (ASPECT_RATIOS as readonly string[]).includes(body.aspectRatio)
        ? (body.aspectRatio as (typeof ASPECT_RATIOS)[number])
        : '16:9';

    const options: ImageGenerationOptions = {
      prompt,
      aspectRatio,
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    };
    const ctx: StepContext = { log, signal: options.signal };

    const started = Date.now();
    let result;
    try {
      result = await generateImageStep({ options, connection }, ctx);
    } catch (error) {
      // A refusal is the step declining before any provider call — no key, no
      // model. That is a configuration answer, not an upstream failure.
      if (error instanceof StepRefusal) {
        return apiError('INVALID_REQUEST', 400, error.message);
      }
      // This is the one place a provider's own words are worth showing: the
      // user is debugging their endpoint, and "invalid model", "insufficient
      // quota" or "unknown field size" is the answer they came for. The request
      // is theirs, against their own endpoint, with their own key.
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Test image generation failed: ${message}`);
      return apiError('UPSTREAM_ERROR', 502, message.slice(0, 2000));
    }

    const ms = Date.now() - started;
    const imageUrl = inlineImage(result);
    log.info(`Test image generated in ${ms}ms (${result.width}x${result.height})`);

    return apiSuccess({
      message: imageUrl
        ? `Generated a ${result.width}x${result.height} image in ${(ms / 1000).toFixed(1)}s.`
        : `Generated a ${result.width}x${result.height} image in ${(ms / 1000).toFixed(1)}s, but it is too large to preview here.`,
      ms,
      width: result.width,
      height: result.height,
      model: connection.modelId ?? '',
      providerId: connection.providerId,
      ...(imageUrl ? { imageUrl } : {}),
    });
  } catch (error) {
    log.error(`Test image generation errored: ${error}`, error);
    return apiError('INTERNAL_ERROR', 500, 'Test generation failed');
  }
}
