'use client';

import { useState, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { CatalogueModel } from '@/lib/config/provider-presets';
import { cn } from '@/lib/utils';
import {
  ApiKeyField,
  EndpointServerOnlyHint,
  ServerConfiguredNotice,
  ServerOnlyNotice,
  saveServiceProvider,
  verifySavedMedia,
  type ServicePanelProps,
} from './server-settings';
import { CustomEndpointForm } from './custom-endpoint-form';

/**
 * An image or video service: its key (write-only) with a connection test, the
 * endpoint it calls, and the models it offers. A service the server
 * configures is shown read-only, and one only the server can configure says so.
 *
 * A service the workspace points at an endpoint of its own (`custom-image`,
 * `custom-video`) is the exception: its endpoint and models are the workspace's
 * to name, so the form below edits them rather than showing them as the
 * server's.
 */
export function MediaServicePanel({
  view,
  apply,
  entry,
  kind,
  defaultBaseUrl,
  catalogue,
  children,
}: ServicePanelProps & {
  kind: 'image' | 'video';
  /** The registry's endpoint, shown as the request URL. */
  defaultBaseUrl?: string;
  /** The registry's models, for a service no provider of which is saved yet. */
  catalogue: readonly CatalogueModel[];
  /** What replaces the model list (ComfyUI's workflows). */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const provider = entry.provider;
  const editable = entry.state === 'workspace' || entry.state === 'available';
  const [testLoading, setTestLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const models =
    provider?.capabilities[kind]?.models ?? entry.preset?.capabilities[kind]?.models ?? catalogue;
  /**
   * A service the workspace points at an endpoint of its own (`custom-image`,
   * `custom-video`): the base URL and the model list are the workspace's to
   * supply, so both are edited here rather than shown as the server's.
   */
  const customEndpoint = editable && !!entry.preset?.customEndpoint;
  const success = t(
    kind === 'image' ? 'settings.imageConnectivitySuccess' : 'settings.videoConnectivitySuccess',
  );
  const failed = t(
    kind === 'image' ? 'settings.imageConnectivityFailed' : 'settings.videoConnectivityFailed',
  );

  const handleTest = async () => {
    setTestLoading(true);
    setTestStatus('idle');
    setTestMessage('');
    try {
      const data = await verifySavedMedia(kind, entry.id);
      if (data.success) {
        setTestStatus('success');
        setTestMessage(success);
      } else {
        setTestStatus('error');
        setTestMessage(`${failed}: ${data.error}`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestMessage(`${failed}: ${err}`);
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {entry.state === 'deployment' && <ServerConfiguredNotice view={view} capability={kind} />}
      {entry.state === 'server-only' && <ServerOnlyNotice noUserKeys={!view.allowUserKeys} />}

      {editable && (
        <>
          {customEndpoint ? (
            /* The endpoint is the service: the workspace names it, its key and
               its models here, and saves them together (see the form). */
            <CustomEndpointForm view={view} apply={apply} entry={entry} kind={kind} />
          ) : (
            <>
              {/* API Key + Test inline */}
              <div className="space-y-2">
                <Label>API Key</Label>
                <ApiKeyField
                  name={`${kind}-api-key-${entry.id}`}
                  provider={provider}
                  onSave={(apiKey) => saveServiceProvider(view, apply, entry, { apiKey }, t)}
                  onRemove={() => saveServiceProvider(view, apply, entry, { apiKey: '' }, t)}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTest()}
                    disabled={testLoading || !provider}
                    className="gap-1.5"
                  >
                    {testLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Zap className="h-3.5 w-3.5" />
                        {t('settings.testConnection')}
                      </>
                    )}
                  </Button>
                </ApiKeyField>
                {testMessage && (
                  <div
                    className={cn(
                      'rounded-lg p-3 text-sm overflow-hidden',
                      testStatus === 'success' &&
                        'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
                      testStatus === 'error' &&
                        'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
                    )}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {testStatus === 'success' && (
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                      )}
                      {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                      <p className="flex-1 min-w-0 break-all">{testMessage}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Base URL: the service's own endpoint; another one is the server's to set. */}
              <div className="space-y-2">
                <Label>Base URL</Label>
                {defaultBaseUrl && (
                  <p className="text-xs text-muted-foreground break-all">
                    {t('settings.requestUrl')}: {defaultBaseUrl}
                  </p>
                )}
                <EndpointServerOnlyHint />
              </div>
            </>
          )}
        </>
      )}

      {/* A custom endpoint's models are the ones the form above holds, and its
          registry has no catalogue to fall back on: there is nothing to list
          here that the workspace did not just type. */}
      {customEndpoint
        ? null
        : (children ?? (
            <div className="space-y-3">
              <Label className="text-base">{t('settings.models')}</Label>
              <div className="space-y-1.5">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm font-medium">{model.name}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {model.id}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
    </div>
  );
}
