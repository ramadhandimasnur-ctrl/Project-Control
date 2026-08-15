'use client';

import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { filterIndexed, indexOptions, visibleWithSelection } from '@/lib/ui/combobox-filter';
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
 * Matching lives in lib/ui/combobox-filter so it can be tested directly.
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

/** Height the panel needs before it prefers opening downwards, in pixels. */
const PANEL_SPACE = 320;

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Pilih…',
  searchPlaceholder = 'Ketik untuk mencari…',
  emptyMessage = 'Tidak ada yang cocok.',
  disabled,
  invalid,
  describedBy,
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
  /** Id of the error text, so the trigger announces why it is marked wrong. */
  describedBy?: string;
  id?: string;
  className?: string;
  maxVisible?: number;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-list`;
  const optionId = (index: number) => `${listId}-opt-${index}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropUp, setDropUp] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Built once per option list, not per keystroke.
  const indexed = useMemo(() => indexOptions(options), [options]);
  const filtered = useMemo(() => filterIndexed(indexed, query), [indexed, query]);

  /*
   * The chosen row is always among the rendered ones. Without this, a
   * selection sitting past the cap — likely, at 379 options — would leave the
   * panel opening with no tick anywhere, as if nothing had been chosen.
   */
  const visible = useMemo(
    () => visibleWithSelection(filtered, maxVisible, value),
    [filtered, maxVisible, value],
  );

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

    // Open on the current choice rather than the top of the list.
    const chosenAt = visible.findIndex((option) => option.value === value);
    setActiveIndex(chosenAt >= 0 ? chosenAt : 0);

    // Flip upwards when the field sits too low for the panel to fit below it.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setDropUp(below < PANEL_SPACE && rect.top > below);
    }

    // Focus the search box, not the list: typing is the point.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
    // Deliberately runs on open alone — reacting to `visible` would reset the
    // highlight on every keystroke, fighting the arrow keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    triggerRef.current?.focus();
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
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
      // Stops here rather than bubbling: without this the surrounding dialog
      // takes the same Escape and the whole form closes behind the dropdown.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
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
        ref={triggerRef}
        type="button"
        id={controlId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        /* Not aria-invalid: that property has no meaning on a plain button. */
        data-invalid={invalid ? '' : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-background py-0 pl-2.5 text-left text-sm outline-none',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-invalid:border-destructive data-invalid:ring-3 data-invalid:ring-destructive/20',
          selected && !disabled ? 'pr-14' : 'pr-8',
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
          <span className="flex-1 truncate text-muted-foreground">{placeholder}</span>
        )}
      </button>

      {/*
        Sibling of the trigger, not a child of it: a control nested inside a
        button is invalid markup and screen readers announce it inconsistently.
      */}
      {selected && !disabled ? (
        <button
          type="button"
          aria-label="Kosongkan pilihan"
          onClick={() => {
            onValueChange('');
            triggerRef.current?.focus();
          }}
          className="absolute top-1/2 right-7 -translate-y-1/2 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}

      <ChevronsUpDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />

      {open ? (
        <div
          className={cn(
            'absolute z-50 w-full overflow-hidden rounded-lg border bg-popover shadow-md',
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          <div className="flex items-center gap-2 border-b px-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-invalid={invalid}
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                visible.length > 0 && activeIndex >= 0 ? optionId(activeIndex) : undefined
              }
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
                    id={optionId(index)}
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
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        isSelected ? 'opacity-100' : 'opacity-0',
                      )}
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
