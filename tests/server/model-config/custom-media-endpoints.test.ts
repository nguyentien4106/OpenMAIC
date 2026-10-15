/**
 * A workspace's own media endpoint (`custom-image`, `custom-video`).
 *
 * These two presets are the media counterpart of the chat `openai-compatible`
 * one: the workspace names the endpoint, the key and the models, and the
 * endpoint IS the service. Everything else keeps the deployment-only rule, so
 * these tests guard both halves — that the new presets work end to end, and
 * that the boundary they were carved out of is still closed for every existing
 * service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ forwarded: new Map<string, string>() }));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({ pool: {} }),
}));
vi.mock('@/lib/persistence/owner-merges', () => ({
  isOwnerRetired: async () => false,
  canonicalizeStoredOwner: async (ownerId: string) => mocks.forwarded.get(ownerId) ?? ownerId,
}));

const { PROVIDER_PRESETS, allowsWorkspaceEndpoint, getProviderPreset } =
  await import('@/lib/config/provider-presets');
const runtime = await import('@/lib/server/model-config/runtime');
const { WorkspaceEndpointError, resolveMediaSlot } =
  await import('@/lib/server/model-config/media');
const { applyModelSettingsChange, modelSettingsView } =
  await import('@/lib/server/model-config/settings');

type Config = import('@/lib/server/model-config/openmaic-yml').ModelConfigFile;
const workspaces = new Map<string, Config>();

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  mocks.forwarded.clear();
  workspaces.clear();
  runtime.setDeploymentConfigForTests({ layer: null, legacy: false, notices: [] });
  runtime.setWorkspaceLayerLoaderForTests(async (ownerId) => {
    const config = workspaces.get(ownerId);
    return config ? { source: 'workspace', config } : null;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  runtime.setDeploymentConfigForTests();
  runtime.setWorkspaceLayerLoaderForTests();
});

describe('the custom media presets', () => {
  it('are the only media presets that accept a workspace endpoint', () => {
    const accepting = PROVIDER_PRESETS.filter((preset) => allowsWorkspaceEndpoint(preset, 'image'))
      .map((preset) => preset.id)
      .concat(
        PROVIDER_PRESETS.filter((preset) => allowsWorkspaceEndpoint(preset, 'video')).map(
          (preset) => preset.id,
        ),
      );
    expect(accepting.sort()).toEqual(['custom-image', 'custom-video']);
  });

  it('need a base URL and describe no catalogue of their own', () => {
    for (const id of ['custom-image', 'custom-video']) {
      const preset = getProviderPreset(id);
      expect(preset).toBeDefined();
      expect(preset?.requiresBaseUrl).toBe(true);
      // Nothing in the build describes what sits behind the endpoint, which is
      // exactly why the workspace's own model list is the catalogue.
      expect(preset?.trustsModelCatalogue).toBe(false);
      expect(preset?.capabilities.image ?? preset?.capabilities.video).toBeDefined();
    }
  });

  it('list the workspace endpoint as a service it may set up, not a server-only one', () => {
    const view = modelSettingsView(null);
    for (const id of ['custom-image', 'custom-video']) {
      const listed = view.presets.find((preset) => preset.id === id);
      expect(listed).toBeDefined();
      expect(listed?.customEndpoint).toBe(true);
      expect(listed?.requiresBaseUrl).toBe(true);
    }
  });
});

describe('saving a custom media provider', () => {
  const customImage = {
    providers: {
      gateway: {
        preset: 'custom-image',
        apiKey: 'sk-gateway-000000',
        baseUrl: 'https://1.1.1.1/v1',
        models: ['my-image-model'],
      },
    },
  };

  it('offers the workspace its own model ids for the capability', () => {
    const view = modelSettingsView({ config: customImage, revision: 1, unreadableSecrets: [] });
    const provider = view.providers.find((entry) => entry.id === 'gateway');
    expect(provider?.capabilities.image?.models.map((model) => model.id)).toEqual([
      'my-image-model',
    ]);
  });

  it('accepts one that names an endpoint, a key and its models', async () => {
    const saved = await applyModelSettingsChange(null, {
      kind: 'provider',
      id: 'gateway',
      preset: 'custom-image',
      apiKey: 'sk-gateway-000000',
      baseUrl: 'https://1.1.1.1/v1',
      models: ['my-image-model'],
    });
    expect(saved.providers?.gateway).toMatchObject({
      preset: 'custom-image',
      baseUrl: 'https://1.1.1.1/v1',
      models: ['my-image-model'],
    });
  });

  it('lets the image slot use it, and the run time reach it as a user endpoint', async () => {
    const assigned = await applyModelSettingsChange(customImage, {
      kind: 'slots',
      set: { image: 'gateway:my-image-model' },
    });
    expect(assigned.slots?.image).toBe('gateway:my-image-model');

    workspaces.set('user:alice', { ...customImage, slots: { image: 'gateway:my-image-model' } });
    const connection = await resolveMediaSlot('image', { workspaceId: 'user:alice' });
    expect(connection).toMatchObject({
      providerId: 'custom-image',
      modelId: 'my-image-model',
      baseUrl: 'https://1.1.1.1/v1',
      managed: false,
      // The address is the workspace's, so the transports police it.
      userEndpoint: true,
    });
  });

  it('refuses one with no model list: it would store a provider that offers nothing', async () => {
    await expect(
      applyModelSettingsChange(null, {
        kind: 'provider',
        id: 'gateway',
        preset: 'custom-image',
        apiKey: 'sk-gateway-000000',
        baseUrl: 'https://1.1.1.1/v1',
      }),
    ).rejects.toThrow(/needs at least one model id/);
  });

  it('refuses one with no endpoint', async () => {
    await expect(
      applyModelSettingsChange(null, {
        kind: 'provider',
        id: 'gateway',
        preset: 'custom-image',
        apiKey: 'sk-gateway-000000',
        models: ['my-image-model'],
      }),
    ).rejects.toThrow(/needs a base URL/);
  });

  it('refuses a local endpoint: a workspace reaches only public addresses', async () => {
    await expect(
      applyModelSettingsChange(null, {
        kind: 'provider',
        id: 'gateway',
        preset: 'custom-image',
        apiKey: 'sk-gateway-000000',
        baseUrl: 'http://localhost:8080/v1',
        models: ['my-image-model'],
      }),
    ).rejects.toThrow(/local|private|public/i);
  });
});

describe('the boundary every other service keeps', () => {
  it('refuses a built-in image service pointed elsewhere', async () => {
    await expect(
      applyModelSettingsChange(null, {
        kind: 'provider',
        id: 'oa',
        preset: 'openai-image',
        apiKey: 'sk-oai-00000000',
        baseUrl: 'https://relay.example.com/v1',
      }),
    ).rejects.toThrow(/can only be configured by the deployment/);
  });

  it('refuses a built-in video service pointed elsewhere', async () => {
    await expect(
      applyModelSettingsChange(null, {
        kind: 'provider',
        id: 'sd',
        preset: 'seedance',
        apiKey: 'sk-ark-00000000',
        baseUrl: 'https://relay.example.com/v1',
      }),
    ).rejects.toThrow(/can only be configured by the deployment/);
  });

  it('refuses at run time a stored built-in image endpoint, not only at save', async () => {
    // Written straight into the layer, as a hand-edited or migrated
    // configuration could be: the check cannot live at save alone.
    workspaces.set('user:alice', {
      providers: {
        oa: { preset: 'openai-image', apiKey: 'k', baseUrl: 'https://relay.example.com/v1' },
      },
      slots: { image: 'oa:gpt-image-2' },
    });
    await expect(resolveMediaSlot('image', { workspaceId: 'user:alice' })).rejects.toBeInstanceOf(
      WorkspaceEndpointError,
    );
  });

  it('still refuses the image slot a built-in service the workspace repointed', async () => {
    const stored = {
      providers: {
        oa: { preset: 'openai-image', apiKey: 'k', baseUrl: 'https://relay.example.com/v1' },
      },
    };
    await expect(
      applyModelSettingsChange(stored, { kind: 'slots', set: { image: 'oa:gpt-image-2' } }),
    ).rejects.toMatchObject({ code: 'INVALID_ASSIGNMENT' });
  });
});
