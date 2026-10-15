/**
 * Custom Image Adapter (`custom-image`)
 *
 * A workspace's own OpenAI-compatible image endpoint: the workspace supplies
 * the base URL, the key and the model ids, and this adapter reaches it at
 * `POST {baseUrl}/images/generations` — the de-facto standard shape that
 * OpenAI, Azure, and the great majority of relays and self-hosted servers
 * speak. Generation is delegated to the OpenAI image adapter, so the request,
 * the redirect refusal and the `url`/`b64_json` handling stay in one place.
 *
 * Only the connectivity probe differs. The OpenAI adapter's probe asks
 * `GET {baseUrl}/models/{model}`, which a gateway that serves images only does
 * not implement — it would report a false failure on a perfectly working
 * endpoint. This one probes the catalogue route instead
 * (`lib/media/probe-catalogue.ts`), which also states honestly whether the
 * answer verified the key or merely the address.
 *
 * The endpoint is user input: server callers reach it through the strict
 * public-network transport (`withMediaProviderFetch(..., managed: false)`),
 * which refuses private addresses unless the operator opted in.
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';
import { mediaFetchFor } from '../media-fetch';
import { probeModelCatalogue } from '../probe-catalogue';
import { generateWithOpenAIImage } from './openai-image-adapter';

const PROVIDER_NAME = 'Custom Image';

/**
 * Normalise a user-entered base URL to the API root.
 *
 * The settings field is labelled "Base URL", but the natural mistake is to
 * paste the full request URL (`https://relay.example.com/v1/images/generations`),
 * which would build `.../images/generations/images/generations` and 404. Trim a
 * trailing slash and a trailing `/images/generations` or `/images`, so both
 * forms work. The same courtesy the OpenRouter adapters extend.
 */
export function customImageBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || '')
    .replace(/\/+$/, '')
    .replace(/\/images\/generations$/, '')
    .replace(/\/images$/, '');
}

export async function testCustomImageConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = customImageBaseUrl(config.baseUrl);
  if (!baseUrl) {
    return { success: false, message: `${PROVIDER_NAME} needs a Base URL` };
  }
  return probeModelCatalogue({
    providerName: PROVIDER_NAME,
    fetchImpl: mediaFetchFor(config),
    catalogueUrl: `${baseUrl}/models`,
    apiKey: config.apiKey,
  });
}

export async function generateWithCustomImage(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = customImageBaseUrl(config.baseUrl);
  if (!baseUrl) throw new Error('Custom Image needs a Base URL');
  // `size` is the OpenAI field; `aspect_ratio` is what a relay written against
  // a gateway convention expects (OpenRouter's image route documents it, and
  // so do several OpenAI-compatible relays). Both are sent when the caller has
  // a ratio, since they express the same shape and an endpoint reads the one it
  // knows. The strict OpenAI shape stays on the `openai-image` provider.
  return generateWithOpenAIImage(
    { ...config, baseUrl },
    options,
    options.aspectRatio ? { aspect_ratio: options.aspectRatio } : undefined,
  );
}
