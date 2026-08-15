'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Field wrappers shared by the master-data dialogs.
 *
 * Declared at module level rather than inside each form: a component defined
 * during render is a new type on every keystroke, so React unmounts and
 * remounts it and the field loses focus mid-typing.
 *
 * Selects here are native elements, not the popover component used elsewhere.
 * They register directly with react-hook-form, keyboard and screen-reader
 * behaviour comes free, and a list of thirty units needs nothing more.
 */

export function FieldShell({
  htmlFor,
  label,
  hint,
  error,
  className,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export const selectClassName =
  'flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none ' +
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

type Registration = {
  name: string;
  onChange: React.ChangeEventHandler;
  onBlur: React.FocusEventHandler;
  ref: React.Ref<never>;
};

export function TextField({
  id,
  label,
  hint,
  error,
  registration,
  className,
  ...props
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: Registration;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, 'id' | 'name'>) {
  return (
    <FieldShell htmlFor={id} label={label} hint={hint} error={error} className={className}>
      <Input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
        {...registration}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  id,
  label,
  hint,
  error,
  registration,
  rows = 3,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: Registration;
  rows?: number;
}) {
  return (
    <FieldShell htmlFor={id} label={label} hint={hint} error={error}>
      <Textarea
        id={id}
        rows={rows}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...registration}
      />
    </FieldShell>
  );
}

export function SelectField({
  id,
  label,
  hint,
  error,
  registration,
  options,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  registration: Registration;
  options: { value: string; label: string }[];
  /** Rendered as an empty-valued first option, for optional fields. */
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <FieldShell htmlFor={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={selectClassName}
        {...registration}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
