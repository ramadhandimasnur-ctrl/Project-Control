'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/components/error-state';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <ErrorState
        message="Halaman ini gagal dimuat."
        hint="Coba muat ulang. Bila masalah berlanjut, hubungi administrator dan sebutkan waktu kejadiannya."
        onRetry={reset}
      />
    </div>
  );
}
