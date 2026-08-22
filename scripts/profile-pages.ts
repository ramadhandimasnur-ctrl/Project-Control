/*
 * Times the service calls behind each page, against the real database.
 *
 * Navigation feeling slow is a claim about wall time, and wall time has only
 * two ingredients here: how many round trips a page makes, and how long each
 * one takes. Guessing at either produces optimisations that move nothing. This
 * runs the actual service functions — not a reimplementation of their queries —
 * so what it reports is what a request would have paid.
 *
 * Usage: npx tsx --conditions=react-server scripts/profile-pages.ts
 */
import { loadScriptEnv } from '../src/db/script-client';

loadScriptEnv();

type Timing = { label: string; ms: number };

async function time<T>(label: string, fn: () => Promise<T>, into: Timing[]): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    into.push({ label, ms: Math.round(performance.now() - started) });
  }
}

function report(page: string, timings: Timing[], total: number): void {
  const longest = Math.max(...timings.map((t) => t.ms), 1);
  console.log(`\n${page}  —  ${Math.round(total)}ms`);
  for (const t of timings.sort((a, b) => b.ms - a.ms)) {
    const bar = '█'.repeat(Math.max(1, Math.round((t.ms / longest) * 32)));
    console.log(`  ${String(t.ms).padStart(5)}ms  ${bar} ${t.label}`);
  }
}

async function main(): Promise<void> {
  const { db } = await import('../src/db');
  const { sql } = await import('drizzle-orm');

  const [row] = await db.execute<{ user_id: string; project_id: string; name: string }>(
    sql`SELECT u.id AS user_id, p.id AS project_id, p.name
        FROM projects p
        JOIN users u ON u.org_id = p.org_id AND u.global_role = 'ADMIN' AND u.is_active
        ORDER BY (SELECT count(*) FROM work_items w WHERE w.project_id = p.id) DESC LIMIT 1`,
  );
  if (!row) throw new Error('Tidak ada proyek dengan admin aktif untuk diukur.');
  const { user_id: userId, project_id: projectId } = row;
  console.log(`Proyek: ${row.name}\n${'='.repeat(60)}`);

  // Baseline: one trivial query, so every figure below can be read as
  // "how many round trips is this worth".
  const rtt: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const s = performance.now();
    await db.execute(sql`SELECT 1`);
    rtt.push(performance.now() - s);
  }
  rtt.sort((a, b) => a - b);
  console.log(`Latensi satu round trip (median): ${Math.round(rtt[2]!)}ms`);

  const ahsp = await import('../src/services/ahsp');
  const wb = await import('../src/services/work-breakdown');
  const units = await import('../src/services/units');
  const orgAccess = await import('../src/services/org-access');
  const resources = await import('../src/services/resources');
  const templates = await import('../src/services/ahsp-templates');
  const projects = await import('../src/services/projects');
  
  const progress = await import('../src/services/progress');
  const members = await import('../src/services/members');
  const cash = await import('../src/services/cash');

  // --- Dasbor Eksekutif (EVM) --------------------------------------------
  {
    const t: Timing[] = [];
    const started = performance.now();
    await time('getProject', () => projects.getProject(userId, projectId), t);
    // Broken down: the summary already runs these four in parallel, so its
    // wall time is the slowest of them, not their sum.
    const schedule = await import('../src/services/schedule');
    await Promise.all([
      time('· getScheduleOverview', () => schedule.getScheduleOverview(userId, projectId), t),
      time('· getProgressComparison', () => progress.getProgressComparison(userId, projectId), t),
      time('· getCashflow', () => cash.getCashflow(userId, projectId), t),
      time('· getFinancialSummary', () => cash.getFinancialSummary(userId, projectId), t),
    ]);
    report('Dasbor Eksekutif (EVM)', t, performance.now() - started);
  }

  // --- Pekerjaan & AHSP ---------------------------------------------------
  {
    const t: Timing[] = [];
    const started = performance.now();
    await time('getProject', () => projects.getProject(userId, projectId), t);
    const [items] = await Promise.all([
      time('listWorkItems', () => wb.listWorkItems(userId, projectId), t),
      time('listUnits', () => units.listUnits(userId), t),
      time('canViewOrgCosts', () => orgAccess.canViewOrgCosts(userId), t),
      time('listApplicableTemplates', () => templates.listApplicableTemplates(userId), t),
    ]);
    const first = items[0];
    if (first) {
      await Promise.all([
        time('getWorkItemEstimate', () => ahsp.getWorkItemEstimate(userId, projectId, first.id), t),
        time(
          'getWorkItemDeletionImpact',
          () => wb.getWorkItemDeletionImpact(userId, projectId, first.id),
          t,
        ),
        time('listResources(500)', () => resources.listResources(userId, { limit: 500 }), t),
      ]);
    }
    report('Pekerjaan & AHSP', t, performance.now() - started);
  }

  // --- RAB ----------------------------------------------------------------
  {
    const t: Timing[] = [];
    const started = performance.now();
    await time('getProject', () => projects.getProject(userId, projectId), t);
    await time('getProjectEstimate', () => ahsp.getProjectEstimate(userId, projectId), t);
    report('RAB / RAP', t, performance.now() - started);
  }

  // --- Input Progres ------------------------------------------------------
  {
    const t: Timing[] = [];
    const started = performance.now();
    await time('getProject', () => projects.getProject(userId, projectId), t);
    await time('getProgressBoard', () => progress.getProgressBoard(userId, projectId), t);
    report('Input Progres', t, performance.now() - started);
  }

  // --- Anggota ------------------------------------------------------------
  {
    const t: Timing[] = [];
    const started = performance.now();
    const project = await time('getProject', () => projects.getProject(userId, projectId), t);
    await time('listMembers', () => members.listMembers(userId, projectId), t);
    await time('listOrgUsers', () => projects.listOrgUsers(project.orgId), t);
    report('Anggota', t, performance.now() - started);
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
