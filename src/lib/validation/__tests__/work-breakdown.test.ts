import { describe, expect, it } from 'vitest';

import {
  ahspLineFormSchema,
  takeoffFormSchema,
  WORK_ITEM_FORM_DEFAULTS,
  workItemFormSchema,
} from '../work-breakdown';

const UUID = '11111111-2222-4333-8444-555555555555';

const workItem = (overrides: Record<string, unknown> = {}) => ({
  ...WORK_ITEM_FORM_DEFAULTS,
  code: 'A.01',
  name: 'Beton K-225',
  unitId: UUID,
  ...overrides,
});

const messageFor = (
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  field: string,
) => result.error?.issues.find((i) => String(i.path[0]) === field)?.message;

describe('workItemFormSchema — optional group', () => {
  /*
   * "Tanpa kelompok" has to survive every shape a select can produce. A native
   * <select> submits '', react-hook-form can hand back undefined for a field
   * that was never touched, and an edit form seeded from the database starts
   * out as null.
   */
  it('accepts an empty string from the placeholder option', () => {
    const result = workItemFormSchema.safeParse(workItem({ groupId: '' }));
    expect(result.success).toBe(true);
    expect(result.data?.groupId).toBeNull();
  });

  it('accepts a missing field', () => {
    const values = workItem();
    delete (values as Record<string, unknown>).groupId;
    const result = workItemFormSchema.safeParse(values);
    expect(result.success).toBe(true);
    expect(result.data?.groupId).toBeNull();
  });

  it('accepts an explicit null', () => {
    const result = workItemFormSchema.safeParse(workItem({ groupId: null }));
    expect(result.success).toBe(true);
    expect(result.data?.groupId).toBeNull();
  });

  it('accepts the sentinel used by the popover select', () => {
    const result = workItemFormSchema.safeParse(workItem({ groupId: '__none__' }));
    expect(result.success).toBe(true);
    expect(result.data?.groupId).toBeNull();
  });

  it('keeps a real group id', () => {
    const result = workItemFormSchema.safeParse(workItem({ groupId: UUID }));
    expect(result.data?.groupId).toBe(UUID);
  });
});

describe('workItemFormSchema — contract unit price', () => {
  // Absent and zero mean different things: no price yet versus deliberately
  // not billed on its own line.
  it('turns a blank price into null so the estimate falls back to RAB', () => {
    expect(workItemFormSchema.safeParse(workItem({ contractUnitPrice: '' })).data?.contractUnitPrice)
      .toBeNull();
  });

  it('keeps an explicit zero', () => {
    expect(
      workItemFormSchema.safeParse(workItem({ contractUnitPrice: '0' })).data?.contractUnitPrice,
    ).toBe('0.00');
  });

  it('accepts null the same way as blank', () => {
    expect(
      workItemFormSchema.safeParse(workItem({ contractUnitPrice: null })).data?.contractUnitPrice,
    ).toBeNull();
  });

  it('rejects a price that is not a number', () => {
    const result = workItemFormSchema.safeParse(workItem({ contractUnitPrice: 'nego' }));
    expect(result.success).toBe(false);
    expect(messageFor(result, 'contractUnitPrice')).toMatch(/angka/i);
  });
});

describe('workItemFormSchema — required fields', () => {
  it('requires a unit', () => {
    const result = workItemFormSchema.safeParse(workItem({ unitId: '' }));
    expect(messageFor(result, 'unitId')).toMatch(/Satuan wajib dipilih/);
  });

  it('requires a code and a name', () => {
    expect(workItemFormSchema.safeParse(workItem({ code: '' })).success).toBe(false);
    expect(workItemFormSchema.safeParse(workItem({ name: '   ' })).success).toBe(false);
  });

  it('serialises the volume at the quantity scale', () => {
    expect(workItemFormSchema.safeParse(workItem({ volume: '12.34567' })).data?.volume).toBe(
      '12.3457',
    );
  });
});

describe('takeoffFormSchema', () => {
  it('turns a blank expression into null', () => {
    const result = takeoffFormSchema.safeParse({
      label: 'Pelat A',
      expression: '',
      qty: '2.5',
      note: '',
      sortOrder: 0,
    });
    expect(result.data?.expression).toBeNull();
    expect(result.data?.note).toBeNull();
  });
});

describe('ahspLineFormSchema', () => {
  const line = (overrides: Record<string, unknown> = {}) => ({
    resourceId: UUID,
    estimateType: 'RAB',
    role: 'MATERIAL',
    coef: '8',
    wasteFactor: '0',
    note: '',
    sortOrder: 0,
    ...overrides,
  });

  it('converts the waste factor from percent to a fraction', () => {
    expect(ahspLineFormSchema.safeParse(line({ wasteFactor: '5' })).data?.wasteFactor).toBe(
      '0.050000',
    );
  });

  // A line contributing nothing is almost always half-entered.
  it('rejects a line whose coefficient is zero', () => {
    const result = ahspLineFormSchema.safeParse(line({ coef: '0' }));
    expect(result.success).toBe(false);
    expect(messageFor(result, 'coef')).toMatch(/lebih besar dari nol/);
  });

  /*
   * The analysis a line belongs to is part of its identity now, not an
   * optional hint: the same resource may sit in one analysis and not the
   * other, and a line that does not say which one cannot be placed.
   */
  it('requires the analysis the line belongs to', () => {
    const values = line();
    delete (values as Record<string, unknown>).estimateType;
    expect(ahspLineFormSchema.safeParse(values).success).toBe(false);
  });

  it('accepts a line on either analysis', () => {
    expect(ahspLineFormSchema.safeParse(line({ estimateType: 'RAB' })).success).toBe(true);
    expect(ahspLineFormSchema.safeParse(line({ estimateType: 'RAP' })).success).toBe(true);
  });
});
