import { z } from 'zod';

import { optionalId, requiredText } from './common';
import { dayField } from './numeric';

/**
 * Form schemas for the schedule.
 *
 * Dates are optional here on purpose: a work item can be listed in the Gantt
 * before anyone has committed to when it runs, and forcing a date would push
 * users into inventing one.
 */

const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

export const DEPENDENCY_LABELS: Record<(typeof DEPENDENCY_TYPES)[number], string> = {
  FS: 'Selesai → Mulai',
  SS: 'Mulai → Mulai',
  FF: 'Selesai → Selesai',
  SF: 'Mulai → Selesai',
};

/** Optional date: an untouched or cleared field means "not decided yet". */
const optionalDay = (label: string) =>
  z
    .union([dayField(label), z.literal(''), z.null()])
    .default(null)
    .transform((v) => (v === '' || v === null || v === undefined ? null : v));

export const workItemScheduleFormSchema = z
  .object({
    plannedStart: optionalDay('Tanggal mulai'),
    plannedFinish: optionalDay('Tanggal selesai'),
    predecessorId: optionalId(),
    dependencyType: z.enum(DEPENDENCY_TYPES).default('FS'),
    lagDays: z.coerce
      .number({ message: 'Jeda harus berupa angka.' })
      .int('Jeda harus berupa bilangan bulat.')
      .min(-365, 'Jeda terlalu jauh ke belakang.')
      .max(365, 'Jeda terlalu jauh ke depan.')
      .default(0),
  })
  .refine((v) => v.plannedStart === null || v.plannedFinish === null || v.plannedFinish >= v.plannedStart, {
    message: 'Tanggal selesai tidak boleh mendahului tanggal mulai.',
    path: ['plannedFinish'],
  })
  // One date alone cannot place a bar on the Gantt, and a half-filled schedule
  // reads as an oversight rather than a decision.
  .refine((v) => (v.plannedStart === null) === (v.plannedFinish === null), {
    message: 'Isi kedua tanggal, atau kosongkan keduanya.',
    path: ['plannedFinish'],
  });

export type WorkItemScheduleFormInput = z.input<typeof workItemScheduleFormSchema>;
export type WorkItemScheduleFormValues = z.output<typeof workItemScheduleFormSchema>;

export const WORK_ITEM_SCHEDULE_DEFAULTS = {
  plannedStart: '',
  plannedFinish: '',
  predecessorId: '',
  dependencyType: 'FS',
  lagDays: 0,
} satisfies WorkItemScheduleFormInput;

export const baselineFormSchema = z.object({
  name: requiredText('Nama baseline', 100),
});

export type BaselineFormInput = z.input<typeof baselineFormSchema>;

export const PERIOD_TYPE_LABELS = {
  DAY: 'Harian',
  WEEK: 'Mingguan',
  MONTH: 'Bulanan',
} as const;

export const periodTypeSchema = z.enum(['DAY', 'WEEK', 'MONTH']);
