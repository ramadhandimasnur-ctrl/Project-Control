'use client';

import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { filterIndexed, indexOptions } from '@/lib/ui/combobox-filter';
import { cn } from '@/lib/utils';

/**
 * Searchable dropdown.
 *
 * Written by hand rather than pulled from a registry: this project's UI
 * primitives are Base UI, while the usual shadcn combobox is built on cmdk,
 * and mixing the two brings a second focus-management model into the same
 * dialog. Owning it also keeps the keyboard behaviour and the filtering under
 * our control, which matters at 379 options.
 *
 * Matching is partial and case-insensitive across every haystack a row
 * supplies — code, name and specification — so "besi 12", "M.24" and "polos"
 * all reach the same row. Terms are matched independently, so word order does
 * not have to be guessed.
 */

export type ComboboxOption = {
  value: string;
  /** Primary line, e.g. the resource name. */
  label: string;
  /** Shown before the label in a monospace column, e.g. the code. */
  code?: string;
  /** Secondary line, e.g. the specification. */
  description?: string;
  /** Right-aligned hint, e.g. the unit. */
  meta?: string;
  disabled?: boolean;
};

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Pilih…',
  searchPlaceholder = 'Ketik untuk mencari…',
  emptyMessage = 'Tidak ada yang cocok.',
  disabled,
  invalid,
  id,
  className,
  /**
   * Rows rendered at once. The filter runs over everything; only the display
   * is capped, so a large catalogue stays responsive without hiding matches
   * the user cannot see anyway.
   */
  maxVisible = 100,
}: {
  options: readonly ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  maxVisible?: number;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-list`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Built once per option list, not per keystroke.
  const indexed = useMemo(() => indexOptions(options), [options]);
  const filtered = useMemo(() => filterIndexed(indexed, query), [indexed, query]);

  const visible = filtered.slice(0, maxVisible);
  const selected = options.find((option) => option.value === value) ?? null;

  // Close on outside click; the panel is inline so it has no overlay of its own.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    // Focus the search box, not the list: typing is the point.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const choose = (option: ComboboxOption) => {
    if (option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[activeIndex];
      if (option) choose(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(visible.length - 1);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        id={controlId}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-left text-sm outline-none',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        )}
      >
        {selected ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            {selected.code ? (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {selected.code}
              </span>
            ) : null}
            <span className="truncate">{selected.label}</span>
          </span>
        ) : (
          <span className="flex-1 text-muted-foreground">{placeholder}</span>
        )}

        {selected && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Kosongkan pilihan"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onValueChange('');
            }}
          >
            <X className="size-3.5" aria-hidden />
          </span>
        ) : null}

        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
          <div className="flex items-center gap-2 border-b px-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-autocomplete="list"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={placeholder}
              className="max-h-64 overflow-y-auto p-1"
            >
              {visible.map((option, index) => {
                const isSelected = option.value === value;
                const isActive = index === activeIndex;

                return (
                  <li
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option)}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm',
                      isActive && 'bg-accent text-accent-foreground',
                      option.disabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Check
                      className={cn('mt-0.5 size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        {option.code ? (
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {option.code}
                          </span>
                        ) : null}
                        <span className="truncate font-medium">{option.label}</span>
                      </span>
                      {option.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {option.meta ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{option.meta}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Says why the list stops, so a missing row is never a mystery. */}
          {filtered.length > visible.length ? (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Menampilkan {visible.length} dari {filtered.length} hasil. Persempit pencarian untuk
              melihat sisanya.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
