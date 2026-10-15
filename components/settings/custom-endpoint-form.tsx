'use client';

/**
 * The form for a service the workspace points at an endpoint of its own: a
 * `custom-image` or `custom-video` provider, where the endpoint IS the service.
 *
 * It exists because these presets have no catalogue and no default endpoint, so
 * the two fields every other MediaServicePanel shows read-only — the Base URL
 * and the model list — are exactly the two the workspace must supply. Its key
 * is the third: the workspace types it here and it is sent only when non-empty,
 * so saving other fields never disturbs a stored one.
 *
 * All three save together, on purpose. The server refuses such a provider
 * without a base URL, and a provider with no model list offers nothing to
 * assign, so a field-at-a-time save (the chat panel's pattern) would leave an
 * unusable provider behind between two keystrokes.
 *
 * It reuses the settings' existing strings wherever one already says the right
 * thing (Models, Save, the API key placeholder) and adds a key only for what is
 * genuinely new: the two protocol hints, which are the one thing a user cannot
 * guess from the form.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, ImageIcon, Loader2, Plus, Trash2, XCircle, Zap } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import type { ApplyChange, ModelSettingsView } from '@/lib/model-settings/client';
import type { ServiceEntry } from '@/lib/model-settings/services';
import { SC, saveServiceProvider, testImageGeneration, verifySavedMedia } from './server-settings';

/** The prompt the generation test starts with, so it works with nothing typed. */
const DEFAULT_TEST_PROMPT =
  'A futuristic Vietnamese city at night, neon lights, cinematic, highly detailed';

/** The comma- or newline-separated model ids a field holds, deduped, in order. */
export function parseEndpointModels(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/** The form's draft, as the fields hold it. */
interface Draft {
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** The model id being typed, not yet added. */
  pending: string;
}

function draftFor(entry: ServiceEntry): Draft {
  return {
    baseUrl: entry.provider?.baseUrl ?? '',
    apiKey: '',
    models: entry.provider?.models ?? [],
    pending: '',
  };
}

export function CustomEndpointForm({
  view,
  apply,
  entry,
  kind,
}: {
  view: ModelSettingsView;
  apply: ApplyChange;
  entry: ServiceEntry;
  kind: 'image' | 'video';
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => draftFor(entry));
  const [saving, setSaving] = useState(false);

  // The entry (and so the stored provider) is replaced whenever the view is
  // reloaded — after a save, or by another session. Re-seed the fields from it
  // so they never show a value the server no longer holds, the pattern the
  // add-provider dialog uses. The id is part of the seed because switching
  // between two custom endpoints must not carry one's draft into the other.
  const [seed, setSeed] = useState({ id: entry.id, provider: entry.provider });
  if (seed.id !== entry.id || seed.provider !== entry.provider) {
    setSeed({ id: entry.id, provider: entry.provider });
    setDraft(draftFor(entry));
  }

  const key = entry.provider?.key;
  const keyStored = !!key?.set && !key.unreadable;
  const complete = !!draft.baseUrl.trim() && draft.models.length > 0 && !saving;

  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  // Only a saved provider can be tested: the server resolves its endpoint and
  // key from what it stored, so nothing secret passes through the browser.
  const testable = !!entry.provider && draft.models.length > 0 && !saving && !testing;

  // The real-generation test. Unlike the probe it costs a generation, so it is
  // a separate, explicitly labelled action rather than part of the same click.
  const [prompt, setPrompt] = useState(DEFAULT_TEST_PROMPT);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{
    ok: boolean;
    message: string;
    imageUrl?: string;
  } | null>(null);
  const generatable =
    kind === 'image' && !!entry.provider && draft.models.length > 0 && !generating && !saving;

  const handleGenerateTest = async () => {
    if (!generatable) return;
    setGenerating(true);
    setGenerated(null);
    try {
      const result = await testImageGeneration(entry.id, {
        model: draft.models[0],
        prompt: prompt.trim() || DEFAULT_TEST_PROMPT,
        aspectRatio: '16:9',
      });
      setGenerated(
        result.success
          ? {
              ok: true,
              message: result.message ?? t('settings.customEndpointGenerateOk'),
              ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
            }
          : {
              ok: false,
              // The provider's own words, verbatim: for a failed generation
              // they are the whole diagnosis ("invalid model", "quota", ...).
              message: result.error ?? t('settings.customEndpointGenerateFailed'),
            },
      );
    } catch (error) {
      setGenerated({ ok: false, message: String(error) });
    } finally {
      setGenerating(false);
    }
  };

  const handleTest = async () => {
    if (!testable) return;
    setTesting(true);
    setTest(null);
    try {
      const result = await verifySavedMedia(kind, entry.id, draft.models[0]);
      // The probe's own wording is shown when it has one: for an endpoint the
      // workspace supplied it says whether the address, or the key, was what
      // answered — a distinction a fixed "success" string would hide.
      const fallback = t(
        kind === 'image'
          ? 'settings.imageConnectivitySuccess'
          : 'settings.videoConnectivitySuccess',
      );
      const failed = t(
        kind === 'image' ? 'settings.imageConnectivityFailed' : 'settings.videoConnectivityFailed',
      );
      setTest(
        result.success
          ? { ok: true, message: result.message || fallback }
          : { ok: false, message: `${failed}: ${result.error ?? ''}` },
      );
    } catch (error) {
      setTest({ ok: false, message: String(error) });
    } finally {
      setTesting(false);
    }
  };

  const addPending = () => {
    // A pasted list ("a, b, c" or one id per line) becomes several models: the
    // same text the chat provider form's model field takes.
    const ids = parseEndpointModels(draft.pending);
    if (!ids.length) return;
    setDraft((current) => ({
      ...current,
      pending: '',
      models: [...current.models, ...ids.filter((id) => !current.models.includes(id))],
    }));
  };

  const removeModel = (id: string) => {
    setDraft((current) => ({ ...current, models: current.models.filter((m) => m !== id) }));
  };

  const handleSave = async () => {
    if (!complete) return;
    setSaving(true);
    try {
      const saved = await saveServiceProvider(
        view,
        apply,
        entry,
        {
          baseUrl: draft.baseUrl.trim(),
          models: draft.models,
          // Absent (not empty) when untouched: an empty string would mean
          // "remove the key", which is not what leaving the field alone says.
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        },
        t,
      );
      // Only a save the server took clears the key field; a refused one keeps
      // every value so the user can fix it.
      if (saved) setDraft((current) => ({ ...current, apiKey: '' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${entry.id}-base-url`}>{t('settings.apiBaseUrl')}</Label>
        <Input
          id={`${entry.id}-base-url`}
          type="url"
          placeholder="https://your-gateway.example.com/v1"
          value={draft.baseUrl}
          onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
        />
        <p className="text-xs text-muted-foreground">
          {t(
            kind === 'image'
              ? 'settings.customEndpointImageHint'
              : 'settings.customEndpointVideoHint',
            { baseUrl: draft.baseUrl.trim() || 'https://your-gateway.example.com/v1' },
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${entry.id}-api-key`}>{t('settings.apiKey')}</Label>
        <Input
          id={`${entry.id}-api-key`}
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={
            keyStored
              ? t(`${SC}.keyStoredPlaceholder`, { mask: key?.mask ?? '' })
              : t('settings.enterApiKey')
          }
          value={draft.apiKey}
          onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${entry.id}-model-input`}>{t('settings.models')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id={`${entry.id}-model-input`}
            placeholder={t('settings.modelPlaceholder')}
            value={draft.pending}
            onChange={(event) =>
              setDraft((current) => ({ ...current, pending: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addPending();
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addPending}
            disabled={!draft.pending.trim()}
            className="shrink-0 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('settings.addProviderButton')}
          </Button>
        </div>
        {draft.models.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('settings.fetchModelsNoEndpoint')}</p>
        ) : (
          <div className="space-y-1.5">
            {draft.models.map((id) => (
              <div
                key={id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card p-2.5"
              >
                <span className="truncate font-mono text-sm">{id}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeModel(id)}
                  aria-label={`${t('settings.deleteModel')}: ${id}`}
                  className="shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {test && (
        <div
          className={cn(
            'overflow-hidden rounded-lg p-3 text-sm',
            test.ok
              ? 'border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/50 dark:text-green-400'
              : 'border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400',
          )}
        >
          <div className="flex min-w-0 items-start gap-2">
            {test.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <p className="min-w-0 flex-1 break-all">{test.message}</p>
          </div>
        </div>
      )}

      {kind === 'image' && (
        <div className="space-y-3 rounded-lg border border-border/60 p-3">
          <div className="space-y-1">
            <Label className="text-base">{t('settings.customEndpointGenerateTitle')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.customEndpointGenerateHint')}
            </p>
          </div>
          <Input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={DEFAULT_TEST_PROMPT}
            aria-label={t('settings.customEndpointGeneratePrompt')}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleGenerateTest()}
            disabled={!generatable}
            className="gap-1.5"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" />
            )}
            {generating
              ? t('settings.customEndpointGenerating')
              : t('settings.customEndpointGenerateButton')}
          </Button>

          {generated && (
            <div
              className={cn(
                'space-y-3 overflow-hidden rounded-lg p-3 text-sm',
                generated.ok
                  ? 'border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/50 dark:text-green-400'
                  : 'border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400',
              )}
            >
              <div className="flex min-w-0 items-start gap-2">
                {generated.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                  {generated.message}
                </p>
              </div>
              {generated.imageUrl && (
                /* The proof: the endpoint's own bytes, at the ratio asked for. */
                <img
                  src={generated.imageUrl}
                  alt={t('settings.customEndpointGenerateAlt')}
                  className="w-full max-w-md rounded-lg border border-border/60 bg-card"
                />
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleTest()}
          disabled={!testable}
          className="gap-1.5"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          {t('settings.testConnection')}
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={!complete}
          className="gap-1.5"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('settings.saveModel')}
        </Button>
      </div>
    </div>
  );
}
