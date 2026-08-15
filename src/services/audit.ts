import 'server-only';

import { type DbExecutor } from '@/db';
import { auditLogs } from '@/db/schema';

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'VOID';

export type AuditEntry = {
  orgId?: string | null;
  projectId?: string | null;
  tableName: string;
  recordId?: string | null;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  actorId: string;
};

/**
 * Charter rule 9: every mutation writes an audit row.
 *
 * `executor` is deliberately required and deliberately un-defaulted — the
 * audit row must be written by the *same* transaction as the change it
 * describes, so that a rollback takes the log entry with it. A log that
 * survives a failed write is worse than no log.
 */
export async function writeAuditLog(executor: DbExecutor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLogs).values({
    orgId: entry.orgId ?? null,
    projectId: entry.projectId ?? null,
    tableName: entry.tableName,
    recordId: entry.recordId ?? null,
    action: entry.action,
    before: entry.before === undefined ? null : entry.before,
    after: entry.after === undefined ? null : entry.after,
    actorId: entry.actorId,
  });
}
