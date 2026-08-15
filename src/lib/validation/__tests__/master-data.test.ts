import { describe, expect, it } from 'vitest';

import {
  PRICE_FORM_DEFAULTS,
  priceFormSchema,
  RESOURCE_FORM_DEFAULTS,
  resourceFormSchema,
  SUPPLIER_FORM_DEFAULTS,
  supplierFormSchema,
  UNIT_FORM_DEFAULTS,
  unitFormSchema,
} from '../master-data';

// A real v4 UUID: Zod checks the version and variant nibbles, so a made-up
// string of digits is rejected.
const UUID = '11111111-2222-4333-8444-555555555555';

const resource = (overrides: Record<string, unknown> = {}) => ({
  ...RESOURCE_FORM_DEFAULTS,
  code: 'M.24',
  name: 'besi tulangan',
  unitId: UUID,
  ...overrides,
});

const messageFor = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, field: string) =>
  result.error?.issues.find((i) => String(i.path[0]) === field)?.message;

describe('resourceFormSchema', () => {
  it('accepts a well-formed resource', () => {
    const result = resourceFormSchema.safeParse(resource({ spec: 'polos ø12' }));
    expect(result.success).toBe(true);
    expect(result.data?.spec).toBe('polos ø12');
  });

  // Empty optional text must reach the database as NULL, not "".
  it('turns blank optional text into null', () => {
    const result = resourceFormSchema.safeParse(resource({ spec: '', notes: '   ' }));
    expect(result.data?.spec).toBeNull();
    expect(result.data?.notes).toBeNull();
  });

  it('turns an unpicked category select into null', () => {
    expect(resourceFormSchema.safeParse(resource({ categoryId: '' })).data?.categoryId).toBeNull();
    expect(
      resourceFormSchema.safeParse(resource({ categoryId: '__none__' })).data?.categoryId,
    ).toBeNull();
    expect(resourceFormSchema.safeParse(resource({ categoryId: UUID })).data?.categoryId).toBe(UUID);
  });

  it('requires a unit', () => {
    const result = resourceFormSchema.safeParse(resource({ unitId: '' }));
    expect(result.success).toBe(false);
    expect(messageFor(result, 'unitId')).toMatch(/Satuan wajib dipilih/);
  });

  it('rejects a code with characters that break lookup', () => {
    expect(resourceFormSchema.safeParse(resource({ code: 'M 24' })).success).toBe(false);
    expect(resourceFormSchema.safeParse(resource({ code: 'M#24' })).success).toBe(false);
    // The workbook uses dots and slashes, so those must pass.
    expect(resourceFormSchema.safeParse(resource({ code: 'OP.1.1' })).success).toBe(true);
    expect(resourceFormSchema.safeParse(resource({ code: 'PI/07' })).success).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(resourceFormSchema.safeParse(resource({ name: '  semen  ' })).data?.name).toBe('semen');
  });

  // Text inputs submit strings; the service and the column expect an integer.
  it('coerces lead time from a text input', () => {
    expect(resourceFormSchema.safeParse(resource({ leadTimeDays: '7' })).data?.leadTimeDays).toBe(7);
  });

  it('rejects a negative or fractional lead time', () => {
    expect(resourceFormSchema.safeParse(resource({ leadTimeDays: '-1' })).success).toBe(false);
    expect(resourceFormSchema.safeParse(resource({ leadTimeDays: '2.5' })).success).toBe(false);
  });
});

describe('unitFormSchema', () => {
  const unit = (overrides: Record<string, unknown> = {}) => ({
    ...UNIT_FORM_DEFAULTS,
    code: 'kg',
    name: 'Kilogram',
    dimension: 'MASS',
    ...overrides,
  });

  it('accepts a standalone unit with factor 1', () => {
    expect(unitFormSchema.safeParse(unit()).success).toBe(true);
  });

  it('accepts a derived unit with its factor', () => {
    const result = unitFormSchema.safeParse(unit({ baseUnitId: UUID, factorToBase: '1000' }));
    expect(result.success).toBe(true);
    expect(result.data?.factorToBase).toBe('1000.000000');
  });

  // A conversion factor is meaningless without something to convert to.
  it('rejects a factor other than 1 when no base unit is chosen', () => {
    const result = unitFormSchema.safeParse(unit({ baseUnitId: '', factorToBase: '1000' }));
    expect(result.success).toBe(false);
    expect(messageFor(result, 'factorToBase')).toMatch(/satuan dasar dipilih/);
  });

  it('rejects a zero or negative factor', () => {
    expect(unitFormSchema.safeParse(unit({ baseUnitId: UUID, factorToBase: '0' })).success).toBe(
      false,
    );
    expect(unitFormSchema.safeParse(unit({ baseUnitId: UUID, factorToBase: '-2' })).success).toBe(
      false,
    );
  });

  it('rejects an unknown dimension', () => {
    expect(unitFormSchema.safeParse(unit({ dimension: 'WEIGHT' })).success).toBe(false);
  });
});

describe('supplierFormSchema', () => {
  const supplier = (overrides: Record<string, unknown> = {}) => ({
    ...SUPPLIER_FORM_DEFAULTS,
    code: 'SUP-01',
    name: 'CV Sumber Bangunan',
    ...overrides,
  });

  it('accepts a supplier and nulls its blank fields', () => {
    const result = supplierFormSchema.safeParse(supplier({ contact: '', address: '' }));
    expect(result.success).toBe(true);
    expect(result.data?.contact).toBeNull();
    expect(result.data?.address).toBeNull();
  });

  it('coerces credit days and rejects a negative term', () => {
    expect(supplierFormSchema.safeParse(supplier({ creditDays: '30' })).data?.creditDays).toBe(30);
    expect(supplierFormSchema.safeParse(supplier({ creditDays: '-5' })).success).toBe(false);
  });

  it('requires a name', () => {
    expect(supplierFormSchema.safeParse(supplier({ name: '   ' })).success).toBe(false);
  });
});

describe('priceFormSchema', () => {
  const price = (overrides: Record<string, unknown> = {}) => ({
    ...PRICE_FORM_DEFAULTS,
    price: '48000',
    effectiveFrom: '2026-03-01',
    ...overrides,
  });

  it('serialises the price at the money scale', () => {
    expect(priceFormSchema.safeParse(price()).data?.price).toBe('48000.00');
    expect(priceFormSchema.safeParse(price({ price: '15500.5' })).data?.price).toBe('15500.50');
  });

  it('accepts zero but rejects a negative price', () => {
    expect(priceFormSchema.safeParse(price({ price: '0' })).success).toBe(true);
    expect(priceFormSchema.safeParse(price({ price: '-1' })).success).toBe(false);
  });

  it('rejects a price that is not a number', () => {
    const result = priceFormSchema.safeParse(price({ price: 'tanya supplier' }));
    expect(result.success).toBe(false);
    expect(messageFor(result, 'price')).toMatch(/harus berupa angka/i);
  });

  it('requires a valid effective date', () => {
    expect(priceFormSchema.safeParse(price({ effectiveFrom: '' })).success).toBe(false);
    expect(priceFormSchema.safeParse(price({ effectiveFrom: '01/03/2026' })).success).toBe(false);
    expect(priceFormSchema.safeParse(price({ effectiveFrom: '2026-13-45' })).success).toBe(false);
  });

  it('rejects an unknown price type', () => {
    expect(priceFormSchema.safeParse(price({ priceType: 'AKTUAL' })).success).toBe(false);
  });
});
