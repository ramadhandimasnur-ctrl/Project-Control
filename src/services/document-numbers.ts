import { sql } from 'drizzle-orm';

import { withUser } from '@/db/context';
import type { Transaction } from '@/db';

import { assertProjectAccess } from './access';

/**
 * Sequential document numbers, per project and per kind.
 *
 * Purchase orders, certificates and claims are referred to by number in
 * conversation and on paper, so the numbers have to be predictable and unique.
 * Left to people they collide: two site staff both type PO-014 on the same
 * afternoon and neither finds out until the supplier asks which one to invoice
 * against.
 *
 * The number is only ever a suggestion at the point of entry — a document that
 * arrives with the supplier's own reference on it keeps that reference. What
 * this guarantees is that the *generated* ones never repeat.
 */

export type DocumentKind = 'PURCHASE' | 'CERTIFICATE' | 'CLAIM' | 'COST';

const DEFAULT_PREFIX: Record<DocumentKind, string> = {
  PURCHASE: 'PO',
  CERTIFICATE: 'SC',
  CLAIM: 'INV',
  COST: 'BY',
};

/**
 * Takes the next number, atomically.
 *
 * `INSERT … ON CONFLICT DO UPDATE` rather than read-then-write: two callers
 * arriving together would both read the same last number and both return it.
 * The unique index on (project, kind) is what makes the conflict clause fire,
 * and the whole thing is one statement so there is no window between them.
 *
 * Runs inside the caller's transaction when given one, so a number consumed by
 * a document that then fails to save is rolled back with it. Gaps in a
 * document series are awkward to explain to an auditor.
 */
export async function nextDocumentNumber(
  tx: Transaction,
  projectId: string,
  kind: DocumentKind,
): Promise<string> {
  const [row] = await tx.execute<{ prefix: string; last_number: number; pad_length: number }>(sql`
    INSERT INTO document_counters (project_id, doc_type, prefix, last_number, pad_length)
    VALUES (${projectId}, ${kind}, ${DEFAULT_PREFIX[kind]}, 1, 3)
    ON CONFLICT (project_id, doc_type) DO UPDATE
      SET last_number = document_counters.last_number + 1,
          updated_at = now()
    RETURNING prefix, last_number, pad_length
  `);

  if (!row) throw new Error(`Nomor dokumen ${kind} gagal dibuat.`);

  const digits = String(row.last_number).padStart(row.pad_length, '0');
  return row.prefix === '' ? digits : `${row.prefix}-${digits}`;
}

/**
 * What the next number would be, without consuming it.
 *
 * For pre-filling a form. Deliberately not a reservation: the form may be
 * abandoned, and holding a number open until somebody closes a browser tab is
 * how series end up full of holes.
 */
export async function peekDocumentNumber(
  userId: string,
  projectId: string,
  kind: DocumentKind,
): Promise<string> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [row] = await withUser(userId, (tx) =>
    tx.execute<{ prefix: string; last_number: number; pad_length: number }>(sql`
      SELECT prefix, last_number, pad_length
      FROM document_counters
      WHERE project_id = ${projectId} AND doc_type = ${kind}
    `),
  );

  const prefix = row?.prefix ?? DEFAULT_PREFIX[kind];
  const next = (row?.last_number ?? 0) + 1;
  const digits = String(next).padStart(row?.pad_length ?? 3, '0');

  return prefix === '' ? digits : `${prefix}-${digits}`;
}

export type CounterRow = {
  docType: DocumentKind;
  prefix: string;
  lastNumber: number;
  padLength: number;
  nextNumber: string;
};

export async function listDocumentCounters(
  userId: string,
  projectId: string,
): Promise<CounterRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      doc_type: DocumentKind;
      prefix: string;
      last_number: number;
      pad_length: number;
    }>(sql`
      SELECT doc_type, prefix, last_number, pad_length
      FROM document_counters WHERE project_id = ${projectId}
    `),
  );

  const stored = new Map(rows.map((row) => [row.doc_type, row]));

  // Every kind is listed, including the ones nothing has used yet — a settings
  // screen that hides a counter until it exists cannot be used to set it up.
  return (Object.keys(DEFAULT_PREFIX) as DocumentKind[]).map((kind) => {
    const row = stored.get(kind);
    const prefix = row?.prefix ?? DEFAULT_PREFIX[kind];
    const lastNumber = row?.last_number ?? 0;
    const padLength = row?.pad_length ?? 3;
    const digits = String(lastNumber + 1).padStart(padLength, '0');

    return {
      docType: kind,
      prefix,
      lastNumber,
      padLength,
      nextNumber: prefix === '' ? digits : `${prefix}-${digits}`,
    };
  });
}

/**
 * Changes a series' prefix or width without moving its position.
 *
 * `lastNumber` is deliberately not settable here: winding a counter backwards
 * would hand out numbers that already exist on documents, and winding it
 * forwards to skip a range is better done by explaining the gap than by hiding
 * the control that made it.
 */
export async function updateDocumentCounter(
  userId: string,
  projectId: string,
  kind: DocumentKind,
  input: { prefix: string; padLength: number },
): Promise<void> {
  await assertProjectAccess(userId, projectId, 'PROJECT_MANAGER');

  await withUser(userId, (tx) =>
    tx.execute(sql`
      INSERT INTO document_counters (project_id, doc_type, prefix, last_number, pad_length)
      VALUES (${projectId}, ${kind}, ${input.prefix}, 0, ${input.padLength})
      ON CONFLICT (project_id, doc_type) DO UPDATE
        SET prefix = ${input.prefix}, pad_length = ${input.padLength}, updated_at = now()
    `),
  );
}
