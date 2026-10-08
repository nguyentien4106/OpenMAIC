'use client';

import { useI18n } from '@/lib/hooks/use-i18n';
import { supportedLocales } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface LanguageSwitcherProps {
  /** Called when the dropdown opens, so parent can close sibling dropdowns. */
  onOpen?: () => void;
}

/**
 * Locale picker pill. Backed by Radix DropdownMenu so its content is
 * portaled to `document.body` — important inside Pro mode's CommandBar
 * (which lives under an `overflow-hidden` canvas slot that would
 * otherwise clip the dropdown).
 */
export function LanguageSwitcher({ onOpen }: LanguageSwitcherProps) {
  const { locale, setLocale } = useI18n();

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border border-transparent hover:border-border">
          {supportedLocales.find((l) => l.code === locale)?.shortLabel ?? locale}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[130px] rounded-[6px] border border-border shadow-none">
        {supportedLocales.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onSelect={() => setLocale(l.code)}
            className={cn(
              'cursor-pointer rounded-[4px] text-xs font-medium',
              locale === l.code &&
                'bg-primary/10 text-primary font-semibold dark:bg-primary/20',
            )}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
