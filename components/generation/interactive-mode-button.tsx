'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Atom, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

type InteractiveModeButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'aria-pressed' | 'children'
> &
  DataAttributes & {
    pressed: boolean;
    label: string;
    onPressedChange: (pressed: boolean) => void;
  };

export const InteractiveModeButton = forwardRef<HTMLButtonElement, InteractiveModeButtonProps>(
  function InteractiveModeButton(
    { pressed, label, onPressedChange, className, onClick, ...buttonProps },
    ref,
  ) {
    return (
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        aria-pressed={pressed}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onPressedChange(!pressed);
        }}
        className={cn(
          'relative inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none motion-reduce:active:scale-100',
          pressed
            ? 'border-primary/40 bg-primary/10 text-primary dark:border-primary/50 dark:bg-primary/20 dark:text-primary-foreground'
            : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
          className,
        )}
      >
        {pressed ? (
          <Check aria-hidden="true" className="relative z-10 size-3.5 text-primary" />
        ) : (
          <Atom aria-hidden="true" className="relative z-10 size-3.5 text-muted-foreground" />
        )}
        <span className="relative z-10">{label}</span>
      </button>
    );
  },
);
