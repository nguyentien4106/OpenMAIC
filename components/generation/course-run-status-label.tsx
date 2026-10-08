'use client';

/**
 * The state of the run producing a course, as a course list shows it: the
 * home page's cards and the Pro workspace's course rail say it the same way.
 */
import { AlertCircle, Clock, Loader2 } from 'lucide-react';

import type { CourseRunStatus } from '@/lib/generation-run-client/course-card';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils/cn';

type Translate = ReturnType<typeof useI18n>['t'];

/** The words for a run state ("Generating 2/8", "Paused", …). */
export function courseRunStatusText(status: CourseRunStatus, t: Translate): string {
  switch (status.kind) {
    case 'outlining':
      return t('classroom.runOutlining');
    case 'awaiting-confirmation':
      return t('classroom.runAwaitingConfirmation');
    case 'generating':
      return t('classroom.runGenerating', { completed: status.completed, total: status.total });
    case 'paused':
      return t('classroom.runPaused');
  }
}

/** The run state's icon: a spinner while the run works, else what it waits for. */
export function CourseRunStatusIcon({
  status,
  className,
}: {
  readonly status: CourseRunStatus;
  readonly className?: string;
}) {
  if (status.kind === 'paused') return <AlertCircle className={className} aria-hidden="true" />;
  if (status.kind === 'awaiting-confirmation') {
    return <Clock className={className} aria-hidden="true" />;
  }
  return <Loader2 className={cn('animate-spin', className)} aria-hidden="true" />;
}

/** The pill a course card shows while its run is not over. */
export function CourseRunStatusLabel({ status }: { readonly status: CourseRunStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[11px] font-medium tabular-nums',
        status.kind === 'paused'
          ? 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40'
          : status.kind === 'awaiting-confirmation'
          ? 'bg-red-50 text-red-700 border-red-200/80 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/40'
          : 'bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/40',
      )}
      data-testid="course-run-status"
    >
      <CourseRunStatusIcon status={status} className="size-3" />
      {courseRunStatusText(status, t)}
    </span>
  );
}
