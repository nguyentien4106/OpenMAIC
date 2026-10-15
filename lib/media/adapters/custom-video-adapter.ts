/**
 * Custom Video Adapter (`custom-video`)
 *
 * A workspace's own video gateway: the workspace supplies the base URL, the key
 * and the model ids, and this adapter speaks the OpenRouter-compatible video
 * protocol at it — `POST /videos` to submit, `GET /videos/{id}` to poll,
 * `GET /videos/{id}/content` to fetch the finished clip. Generation is
 * delegated to the OpenRouter video adapter, so submit/poll/download and the
 * polling bounds stay in one place.
 *
 * Why that protocol and not another: every vendor's video API is bespoke
 * (Ark/Seedance, Kling, MiniMax and Veo each differ in shape, auth and task
 * model), so there is no de-facto standard the way `/images/generations` is for
 * images. OpenRouter's `/videos` shape is the one gateway contract in the tree
 * that is already multi-provider by design, which makes it the only honest
 * choice for "point this at your own gateway". A gateway that speaks a vendor's
 * own API instead is configured by the operator in `openmaic.yml`.
 *
 * The endpoint is user input: server callers reach it through the strict
 * public-network transport (`withMediaProviderFetch(..., managed: false)`),
 * which refuses private addresses unless the operator opted in.
 */

import type {
  VideoGenerationConfig,
  VideoGenerationOptions,
  VideoGenerationResult,
} from '../types';
import type { PolledTaskControl } from '../polled-task';
import { mediaFetchFor } from '../media-fetch';
import { probeModelCatalogue } from '../probe-catalogue';
import { openRouterBaseUrl } from './openrouter-image-adapter';
import { generateWithOpenRouterVideo } from './openrouter-video-adapter';

const PROVIDER_NAME = 'Custom Video';

/**
 * Reachability probe: the catalogue route `GET {baseUrl}/videos/models`, which
 * the protocol defines. It states what it actually proved rather than implying
 * a key was checked (`lib/media/probe-catalogue.ts`): OpenRouter's own catalog
 * answers 200 unauthenticated, so a gateway that copies it is reachable but not
 * yet known to accept the key.
 */
export async function testCustomVideoConnectivity(
  config: VideoGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  if (!config.baseUrl?.trim()) {
    return { success: false, message: `${PROVIDER_NAME} needs a Base URL` };
  }
  const baseUrl = openRouterBaseUrl(config.baseUrl);
  return probeModelCatalogue({
    providerName: PROVIDER_NAME,
    fetchImpl: mediaFetchFor(config),
    catalogueUrl: `${baseUrl}/videos/models`,
    apiKey: config.apiKey,
  });
}

export async function generateWithCustomVideo(
  config: VideoGenerationConfig,
  options: VideoGenerationOptions,
  control?: PolledTaskControl,
): Promise<VideoGenerationResult> {
  if (!config.baseUrl?.trim()) throw new Error('Custom Video needs a Base URL');
  return generateWithOpenRouterVideo(config, options, control, PROVIDER_NAME);
}
