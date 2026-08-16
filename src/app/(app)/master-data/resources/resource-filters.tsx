'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = '__all__';

/**
 * Filters live in the URL rather than in component state, so a filtered view
 * can be bookmarked, shared and reloaded — and so the server component does
 * the querying instead of shipping 374 rows to the browser to filter locally.
 */
export function ResourceFilters({
  categories,
  typeLabels,
}: {
  categories: { id: string; name: string }[];
  typeLabels: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [term, setTerm] = useState(params.get('q') ?? '');

  // Debounced: typing a code should not fire a query per keystroke.
  useEffect(() => {
    const current = params.get('q') ?? '';
    if (term === current) return;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (term.trim() === '') next.delete('q');
      else next.set('q', term.trim());
      next.delete('page');
      startTransition(() => router.replace(`${pathname}?${next.toString()}`));
    }, 300);

    return () => clearTimeout(timer);
  }, [term, params, pathname, router]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === ALL) next.delete(key);
    else next.set(key, value);
    next.delete('page');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  const hasFilters = Boolean(params.get('q') ?? params.get('type') ?? params.get('category'));

  /*
   * Base UI renders the raw value in the trigger unless the Root is told how
   * values map to labels — which is why these read "__all__" without it. The
   * lists have to include the sentinel row, since that is the value in force
   * whenever no filter is applied.
   */
  const typeItems = [
    { value: ALL, label: 'Semua jenis' },
    ...Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
  ];

  const categoryItems = [
    { value: ALL, label: 'Semua kategori' },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-64 flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Cari kode, nama, atau spesifikasi…"
          aria-label="Cari sumber daya"
          className="pl-8"
        />
      </div>

      <Select
        items={typeItems}
        value={params.get('type') ?? ALL}
        onValueChange={(v) => setParam('type', v)}
      >
        <SelectTrigger className="w-40" aria-label="Saring jenis">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {typeItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={categoryItems}
        value={params.get('category') ?? ALL}
        onValueChange={(v) => setParam('category', v)}
      >
        <SelectTrigger className="w-56" aria-label="Saring kategori">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categoryItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTerm('');
            startTransition(() => router.replace(pathname));
          }}
        >
          <X className="size-4" aria-hidden />
          Bersihkan
        </Button>
      ) : null}

      <span aria-live="polite" className="text-xs text-muted-foreground">
        {pending ? 'Memuat…' : ''}
      </span>
    </div>
  );
}
