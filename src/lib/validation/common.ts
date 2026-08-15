import { z } from 'zod';

/**
 * Field helpers shared by every form schema.
 *
 * They live here rather than being redefined per file because the first
 * version of them was duplicated, and a gap in one copy — optional selects
 * rejecting `null` — reached the browser as a bare "Invalid input" on the
 * "Tanpa kelompok" option.
 *
 * An optional value arrives in four shapes and all four have to mean the same
 * thing:
 *
 *   ''          a native <select> submitting its placeholder option
 *   undefined   a field react-hook-form never touched
 *   null        a value seeded from a nullable database column
 *   '__none__'  the sentinel the popover select needs, since it cannot use ''
 *
 * All four normalise to `null`, which is what the column stores.
 */

/** The value a popover-style select uses for "none", as it cannot use ''. */
export const NONE_VALUE = '__none__';

const isBlank = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && (value.trim() === '' || value === NONE_VALUE));

/*
 * `.default(null)` is what makes an absent key acceptable. A union that merely
 * includes `z.undefined()` still requires the key to be present in Zod v4, so
 * a form that omits an untouched field would be rejected.
 */

/** Optional foreign key: any empty shape becomes null. */
export const optionalId = () =>
  z
    .union([z.string(), z.null()])
    .default(null)
    .transform((v) => (isBlank(v) ? null : (v as string)));

/** Optional free text, trimmed, with any empty shape becoming null. */
export const optionalText = (max = 500) =>
  z
    .union([z.string(), z.null()])
    .default(null)
    .transform((v, ctx): string | null => {
      if (isBlank(v)) return null;
      const text = String(v).trim();
      if (text.length > max) {
        ctx.addIssue({ code: 'custom', message: `Maksimal ${max} karakter.` });
        return z.NEVER;
      }
      return text;
    });

/** Required identifier, with a message that names the field. */
export const requiredId = (label: string) =>
  z
    .union([z.string(), z.null()])
    .default(null)
    .transform((v, ctx): string => {
      if (isBlank(v)) {
        ctx.addIssue({ code: 'custom', message: `${label} wajib dipilih.` });
        return z.NEVER;
      }
      return String(v);
    })
    .pipe(z.string().uuid(`${label} tidak valid.`));

/** Required, trimmed text. */
export const requiredText = (label: string, max = 200) =>
  z
    .string({ message: `${label} wajib diisi.` })
    .trim()
    .min(1, `${label} wajib diisi.`)
    .max(max, `${label} maksimal ${max} karakter.`);

/** Code-shaped identifier: safe to type, safe to look up. */
export const codeField = (label: string, max = 32) =>
  requiredText(label, max).regex(
    /^[A-Za-z0-9._/-]+$/,
    `${label} hanya boleh berisi huruf, angka, titik, garis miring, garis bawah, dan tanda hubung.`,
  );

/** Whole number of days, never negative. */
export const daysField = (label: string, max = 3650) =>
  z.coerce
    .number({ message: `${label} harus berupa angka.` })
    .int(`${label} harus berupa bilangan bulat.`)
    .min(0, `${label} tidak boleh negatif.`)
    .max(max, `${label} terlalu panjang.`);
