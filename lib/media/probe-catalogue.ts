/**
 * A connectivity probe for an endpoint the workspace supplied itself.
 *
 * The cheap thing an OpenAI-family endpoint answers is its model catalogue
 * (`GET {baseUrl}/models`, or `/videos/models` for the video shape). That is
 * what this probes: nothing is generated, no job is started, nothing is billed.
 *
 * The trap it exists to avoid: relays commonly answer their catalogue
 * *without* authentication. A bare 200 there proves the address is right and
 * says nothing about the key — so an operator who trusts a plain "connected"
 * goes looking through their API's request log for a real call that never
 * happened, because a public listing is not one. A probe that reported success
 * for that, or for a 404, would be worse than no probe at all.
 *
 * So the catalogue is asked twice — with the key, then without — and the answer
 * says which of the two things was actually proven.
 */

import { connectivityHttpFailure, connectivityTransportFailure } from './probe-auth';
import type { MediaProviderFetch } from './types';

export interface CatalogueProbeResult {
  success: boolean;
  message: string;
}

/** One GET of the catalogue: its status, or the transport failure it threw. */
type Reading = { status: number } | { transportError: unknown };

async function read(
  fetchImpl: MediaProviderFetch,
  url: string,
  apiKey: string | undefined,
): Promise<Reading> {
  const key = apiKey?.trim();
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
    });
    // Only the status is needed; release the connection without reading a
    // catalogue that can be hundreds of kilobytes.
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status };
  } catch (error) {
    return { transportError: error };
  }
}

/**
 * Probe a catalogue route and report what it proved.
 *
 * - A non-2xx that is not an auth answer is a failure, 404 included: it means
 *   the address is wrong, and saying "connected" there would be a lie.
 * - 401/403 with the key is an auth failure.
 * - 2xx with the key, where the same listing also answers *without* one, is a
 *   reachability pass only: the message says so instead of implying the key
 *   was checked.
 */
export async function probeModelCatalogue({
  providerName,
  fetchImpl,
  catalogueUrl,
  apiKey,
}: {
  providerName: string;
  fetchImpl: MediaProviderFetch;
  catalogueUrl: string;
  apiKey?: string;
}): Promise<CatalogueProbeResult> {
  const keyed = await read(fetchImpl, catalogueUrl, apiKey);
  if ('transportError' in keyed) {
    return connectivityTransportFailure(providerName, keyed.transportError);
  }
  if (keyed.status === 401 || keyed.status === 403) {
    return connectivityHttpFailure(providerName, keyed.status);
  }
  if (keyed.status < 200 || keyed.status >= 300) {
    return {
      success: false,
      message:
        `${providerName} returned HTTP ${keyed.status} for ${catalogueUrl}. ` +
        'Check the Base URL: it must be the API root (for example …/v1), not a full request path.',
    };
  }

  const keyless = await read(fetchImpl, catalogueUrl, undefined);
  const catalogueIsPublic = 'status' in keyless && keyless.status >= 200 && keyless.status < 300;

  return {
    success: true,
    message: catalogueIsPublic
      ? `Connected to ${providerName}. Its model list answers without a key, so this proves the address and not your key: run a real generation to confirm it.`
      : `Connected to ${providerName}. The key was accepted.`,
  };
}
