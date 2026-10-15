/**
 * The catalogue probe behind a workspace's own media endpoint
 * (`lib/media/probe-catalogue.ts`).
 *
 * The behaviour worth pinning down is the honesty, because the failure it
 * guards against is silent: a probe that reports success for a 404, or for a
 * catalogue that answers *without* a key, tells an operator their setup is
 * verified when nothing about it was — and sends them looking through their
 * API's request log for a call that never happened.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { probeModelCatalogue } from '@/lib/media/probe-catalogue';

const mockFetch = vi.fn() as Mock;

/** A response with only what the probe reads: a status and a cancellable body. */
const status = (code: number) => ({ status: code, body: { cancel: async () => undefined } });

const probe = (apiKey = 'sk-test') =>
  probeModelCatalogue({
    providerName: 'Custom Image',
    fetchImpl: mockFetch as never,
    catalogueUrl: 'https://relay.example.com/v1/models',
    apiKey,
  });

describe('probeModelCatalogue', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fails on a 404 instead of reporting a connection', async () => {
    mockFetch.mockResolvedValueOnce(status(404));
    const result = await probe();
    expect(result.success).toBe(false);
    // The message must carry the URL and the status: that is what tells the
    // user their Base URL is wrong rather than their key.
    expect(result.message).toMatch(/404/);
    expect(result.message).toMatch(/https:\/\/relay\.example\.com\/v1\/models/);
    // Nothing more is asked once the address is known to be wrong.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([500, 502, 400, 422])('fails on HTTP %i', async (code) => {
    mockFetch.mockResolvedValueOnce(status(code));
    expect((await probe()).success).toBe(false);
  });

  it('reports a key the endpoint rejected', async () => {
    mockFetch.mockResolvedValueOnce(status(401));
    const result = await probe();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/auth failed/);
  });

  it('reports a transport failure without leaking its detail', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.1.2.3:443'));
    const result = await probe();
    expect(result.success).toBe(false);
    expect(result.message).not.toMatch(/ECONNREFUSED|10\.1\.2\.3/);
  });

  it('says the key was accepted when the catalogue needs one', async () => {
    mockFetch.mockResolvedValueOnce(status(200)); // with the key
    mockFetch.mockResolvedValueOnce(status(401)); // without it
    const result = await probe();
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/key was accepted/);
    // Two readings: one with the key, one without, to tell the two apart.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer sk-test' });
    expect(mockFetch.mock.calls[1][1].headers).toBeUndefined();
  });

  it('refuses to claim the key was verified when the catalogue answers without one', async () => {
    mockFetch.mockResolvedValueOnce(status(200));
    mockFetch.mockResolvedValueOnce(status(200));
    const result = await probe();
    expect(result.success).toBe(true);
    // Reachable, and honest that this is all it proved.
    expect(result.message).toMatch(/answers without a key/);
    expect(result.message).toMatch(/does not|not your key|run a real generation/);
    expect(result.message).not.toMatch(/key was accepted/);
  });

  it('treats a non-2xx keyless answer as not-public, not as proof of a public catalogue', async () => {
    // With the key 2xx, without it 404: odd, but the key plainly changed the
    // answer, so the one thing it must not do is call the catalogue public.
    mockFetch.mockResolvedValueOnce(status(200));
    mockFetch.mockResolvedValueOnce(status(404));
    const result = await probe();
    expect(result.success).toBe(true);
    expect(result.message).not.toMatch(/answers without a key/);
  });

  it('sends no Authorization header at all when no key is configured', async () => {
    mockFetch.mockResolvedValueOnce(status(200));
    mockFetch.mockResolvedValueOnce(status(200));
    await probe('');
    expect(mockFetch.mock.calls[0][1].headers).toBeUndefined();
  });
});
