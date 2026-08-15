'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';

export function ResourcePagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const lastPage = Math.max(Math.ceil(total / pageSize), 1);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const goTo = (next: number) => {
    const query = new URLSearchParams(params.toString());
    if (next <= 1) query.delete('page');
    else query.set('page', String(next));
    router.replace(query.size === 0 ? pathname : `${pathname}?${query.toString()}`);
  };

  if (total <= pageSize) {
    return (
      <p className="text-sm text-muted-foreground">
        Menampilkan {total.toLocaleString('id-ID')} item.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        {from.toLocaleString('id-ID')}–{to.toLocaleString('id-ID')} dari{' '}
        {total.toLocaleString('id-ID')} item
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
          <ChevronLeft className="size-4" aria-hidden />
          Sebelumnya
        </Button>
        <span className="text-sm text-muted-foreground">
          Halaman {page} dari {lastPage}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => goTo(page + 1)}
        >
          Berikutnya
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
