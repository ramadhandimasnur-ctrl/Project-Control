'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Charter rule 12: an error tells the user what happened and what to do next,
 * and always offers a way forward.
 */
export function ErrorState({
  title = 'Terjadi kesalahan',
  message,
  hint,
  onRetry,
}: {
  title?: string;
  message: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-6 text-destructive" aria-hidden />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      {hint ? <p className="mt-2 max-w-md text-sm text-muted-foreground">{hint}</p> : null}
      {onRetry ? (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
          Coba lagi
        </Button>
      ) : null}
    </div>
  );
}
