/**
 * The adapters behind a workspace's own media endpoint.
 *
 * Both delegate to an existing adapter (the OpenAI image one, the OpenRouter
 * video one) so the request shape lives in one place; what these tests pin down
 * is what the custom provider adds on top: the base-URL normalisation that
 * forgives a pasted full endpoint, the tolerance of a gateway that implements
 * no model catalog, and the removal of another vendor's name from its errors.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  customImageBaseUrl,
  generateWithCustomImage,
  testCustomImageConnectivity,
} from '@/lib/media/adapters/custom-image-adapter';
import {
  generateWithCustomVideo,
  testCustomVideoConnectivity,
} from '@/lib/media/adapters/custom-video-adapter';

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

describe('customImageBaseUrl', () => {
  it.each([
    ['https://relay.example.com/v1', 'https://relay.example.com/v1'],
    ['https://relay.example.com/v1/', 'https://relay.example.com/v1'],
    // The settings field reads like a request URL, so pasting the whole
    // endpoint is the natural mistake; it must not become `.../images/images`.
    ['https://relay.example.com/v1/images', 'https://relay.example.com/v1'],
    ['https://relay.example.com/v1/images/generations', 'https://relay.example.com/v1'],
    ['https://relay.example.com/v1/images/generations/', 'https://relay.example.com/v1'],
  ])('normalises %s', (input, expected) => {
    expect(customImageBaseUrl(input)).toBe(expected);
  });

  it('is empty for no input, rather than falling back to a vendor', () => {
    expect(customImageBaseUrl(undefined)).toBe('');
    expect(customImageBaseUrl('   ')).toBe('');
  });
});

describe('generateWithCustomImage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('posts to the workspace endpoint with its own model and key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn.example.com/image.png' }] }),
    });

    const result = await generateWithCustomImage(
      {
        providerId: 'custom-image',
        apiKey: 'sk-gateway',
        baseUrl: 'https://relay.example.com/v1/images/generations',
        model: 'my-image-model',
      },
      { prompt: 'a classroom diagram', width: 1024, height: 1024 },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://relay.example.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      model: 'my-image-model',
      prompt: 'a classroom diagram',
    });
    expect(result.url).toBe('https://cdn.example.com/image.png');
  });

  it('sends the aspect ratio in both spellings the OpenAI family uses', async () => {
    // `size` is the OpenAI field; `aspect_ratio` is what a relay written
    // against a gateway convention reads (the shape the user's own curl used).
    // Both describe the same image, so an endpoint gets the ratio it knows.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn.example.com/image.png' }] }),
    });

    await generateWithCustomImage(
      {
        providerId: 'custom-image',
        apiKey: 'sk-gateway',
        baseUrl: 'https://kiraai.vn/api/v1',
        model: 'kira-3.0-image',
      },
      { prompt: 'a city', aspectRatio: '16:9', width: 1024, height: 576 },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: 'kira-3.0-image',
      prompt: 'a city',
      n: 1,
      size: '1024x576',
      aspect_ratio: '16:9',
    });
  });

  it('omits aspect_ratio when the caller has no ratio to state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn.example.com/image.png' }] }),
    });
    await generateWithCustomImage(
      {
        providerId: 'custom-image',
        apiKey: 'k',
        baseUrl: 'https://relay.example.com/v1',
        model: 'm',
      },
      { prompt: 'a city' },
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).not.toHaveProperty('aspect_ratio');
  });

  it('forwards an abort signal, so a stuck generation can be given up on', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn.example.com/image.png' }] }),
    });
    const controller = new AbortController();
    await generateWithCustomImage(
      {
        providerId: 'custom-image',
        apiKey: 'k',
        baseUrl: 'https://relay.example.com/v1',
        model: 'm',
      },
      { prompt: 'a city', signal: controller.signal },
    );
    expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('accepts inline bytes, which is what many gateways answer with', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });

    const result = await generateWithCustomImage(
      {
        providerId: 'custom-image',
        apiKey: 'sk-gateway',
        baseUrl: 'https://relay.example.com/v1',
        model: 'my-image-model',
      },
      { prompt: 'a diagram' },
    );
    expect(result.base64).toBe('aGVsbG8=');
  });

  it('refuses to call anything without a base URL', async () => {
    await expect(
      generateWithCustomImage(
        { providerId: 'custom-image', apiKey: 'k', model: 'm' },
        { prompt: 'x' },
      ),
    ).rejects.toThrow(/needs a Base URL/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('testCustomImageConnectivity', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('needs a base URL to probe', async () => {
    const result = await testCustomImageConnectivity({
      providerId: 'custom-image',
      apiKey: 'k',
      model: 'm',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/needs a Base URL/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails on a 404 rather than calling the endpoint connected', async () => {
    // A 404 here means the Base URL is wrong. Reporting success — as an
    // "any answer but 401/403" probe would — is what leaves an operator
    // hunting their API's log for a call that was never made.
    mockFetch.mockResolvedValueOnce({ status: 404, body: { cancel: async () => undefined } });
    const result = await testCustomImageConnectivity({
      providerId: 'custom-image',
      apiKey: 'k',
      baseUrl: 'https://relay.example.com/v1',
      model: 'm',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/404/);
  });

  it('reports a rejected key', async () => {
    mockFetch.mockResolvedValueOnce({ status: 401, body: { cancel: async () => undefined } });
    const result = await testCustomImageConnectivity({
      providerId: 'custom-image',
      apiKey: 'bad',
      baseUrl: 'https://relay.example.com/v1',
      model: 'm',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/auth failed/);
  });

  it('asks the catalogue route, at the normalised base URL', async () => {
    mockFetch.mockResolvedValue({ status: 200, body: { cancel: async () => undefined } });
    await testCustomImageConnectivity({
      providerId: 'custom-image',
      apiKey: 'k',
      // A pasted full endpoint must still probe the root's catalogue.
      baseUrl: 'https://relay.example.com/v1/images/generations',
      model: 'm',
    });
    expect(mockFetch.mock.calls[0][0]).toBe('https://relay.example.com/v1/models');
  });
});

describe('generateWithCustomVideo', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('refuses to call anything without a base URL', async () => {
    await expect(
      generateWithCustomVideo(
        { providerId: 'custom-video', apiKey: 'k', model: 'm' },
        { prompt: 'x' },
      ),
    ).rejects.toThrow(/needs a Base URL/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('names itself rather than OpenRouter when the gateway rejects the submit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'bad model',
    });
    await expect(
      generateWithCustomVideo(
        {
          providerId: 'custom-video',
          apiKey: 'k',
          baseUrl: 'https://relay.example.com/v1',
          model: 'my-video-model',
        },
        { prompt: 'a lesson clip' },
      ),
    ).rejects.toThrow(/Custom Video video submit failed/);
  });
});

describe('testCustomVideoConnectivity', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('needs a base URL to probe', async () => {
    const result = await testCustomVideoConnectivity({
      providerId: 'custom-video',
      apiKey: 'k',
      model: 'm',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/needs a Base URL/);
  });

  it('probes the catalog endpoint the video protocol defines', async () => {
    mockFetch.mockResolvedValue({ status: 200, body: { cancel: async () => undefined } });
    const result = await testCustomVideoConnectivity({
      providerId: 'custom-video',
      apiKey: 'k',
      baseUrl: 'https://relay.example.com/v1',
      model: 'm',
    });
    expect(result.success).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toBe('https://relay.example.com/v1/videos/models');
  });

  it('fails a gateway that does not answer the catalog route', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404, body: { cancel: async () => undefined } });
    const result = await testCustomVideoConnectivity({
      providerId: 'custom-video',
      apiKey: 'k',
      baseUrl: 'https://relay.example.com/v1',
      model: 'm',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/404/);
  });
});
