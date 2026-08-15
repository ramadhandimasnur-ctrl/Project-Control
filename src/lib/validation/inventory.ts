import { z } from 'zod';

import { optionalText, requiredText } from './common';

/**
 * Form schemas for logistics.
 *
 * Same division of labour as the master-data schemas: this checks what was
 * typed, the service checks what needs other rows to decide (a duplicate name,
 * whether the warehouse already holds movements), and the database holds the
 * constraints that must be true regardless of who writes.
 */

// --- warehouse --------------------------------------------------------------

export const warehouseFormSchema = z.object({
  name: requiredText('Nama gudang', 100),
  location: optionalText(200),
  isDefault: z.boolean().default(false),
});

export type WarehouseFormInput = z.input<typeof warehouseFormSchema>;
export type WarehouseFormValues = z.output<typeof warehouseFormSchema>;

export const WAREHOUSE_FORM_DEFAULTS = {
  name: '',
  location: '',
  isDefault: false,
} satisfies WarehouseFormInput;
