import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';

import { estimateWorkItem, type EstimateLine } from '@/lib/calc/estimate';
import { computeWeights, reconcileContractValue, type WeightInput } from '@/lib/calc/weight';
import { formatCurrency, formatPercent } from '@/lib/format';

import {
  DEMO_GROUPS,
  DEMO_ORG_NAME,
  DEMO_PROJECT,
  DEMO_RESOURCES,
  DEMO_UNITS,
  DEMO_USERS,
  DEMO_WORK_ITEMS,
} from './seed/demo-data';
import { createScriptClient, createScriptDb, directUrl, hostOf, loadScriptEnv } from './script-client';
import {
  organizations,
  projectMembers,
  projects,
  resourcePrices,
  resources,
  units,
  users,
  workGroups,
  workItemResources,
  workItems,
} from './schema';

type Db = ReturnType<typeof createScriptDb>;

/**
 * Creates the Supabase Auth accounts for the demo users when a service-role
 * key is configured. Without one the rows are still seeded so the data model
 * is complete, but those accounts cannot sign in — and the script says so
 * rather than leaving the operator to discover it at the login screen.
 */
async function resolveUserIds(): Promise<{ ids: Map<string, string>; canSignIn: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const ids = new Map<string, string>();

  if (!url || !serviceKey || !password) {
    for (const user of DEMO_USERS) {
      ids.set(user.fallbackEmail, randomUUID());
    }
    return { ids, canSignIn: false };
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const user of DEMO_USERS) {
    const email = process.env[user.envEmailKey] ?? user.fallbackEmail;

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    });

    if (created.data.user) {
      ids.set(user.fallbackEmail, created.data.user.id);
      continue;
    }

    // Already registered from a previous run — find and reuse the account.
    const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = existing.data.users.find((u) => u.email === email);
    if (!match) {
      throw new Error(
        `Gagal menyiapkan akun Supabase untuk ${email}: ${created.error?.message ?? 'penyebab tidak diketahui'}`,
      );
    }
    ids.set(user.fallbackEmail, match.id);
  }

  return { ids, canSignIn: true };
}

async function purgeExistingDemo(db: Db): Promise<boolean> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.name, DEMO_ORG_NAME))
    .limit(1);

  if (!org) return false;

  // Deletion order follows the RESTRICT constraints: projects cascade to their
  // own children, then master data, then the users, then the organisation.
  // The cascade reaches the append-only ledgers, hence the escape hatch.
  await db.execute(sql`SELECT set_config('app.allow_hard_delete', 'on', false)`);
  await db.delete(projects).where(eq(projects.orgId, org.id));
  await db.delete(resources).where(eq(resources.orgId, org.id));
  await db.delete(units).where(eq(units.orgId, org.id));
  await db.delete(users).where(eq(users.orgId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  return true;
}

async function main(): Promise<void> {
  loadScriptEnv();
  const url = directUrl();
  const reset = process.argv.includes('--reset');

  console.log(`Menyiapkan data demo pada ${hostOf(url)} …`);

  const client = createScriptClient();
  const db = createScriptDb(client);

  try {
    // The seed runs outside row-level security: there is no user to act as yet.
    await client`SELECT set_config('app.bypass_rls', 'on', false)`;

    const existed = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.name, DEMO_ORG_NAME))
      .limit(1);

    if (existed.length > 0) {
      if (!reset) {
        console.error(
          `Data demo "${DEMO_ORG_NAME}" sudah ada.\n` +
            'Jalankan dengan --reset untuk menghapus dan membuat ulang:\n' +
            '  npm run db:seed -- --reset',
        );
        process.exitCode = 1;
        return;
      }
      await purgeExistingDemo(db);
      console.log('Data demo lama dihapus.');
    }

    const { ids: userIds, canSignIn } = await resolveUserIds();

    const summary = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: DEMO_ORG_NAME })
        .returning({ id: organizations.id });
      if (!org) throw new Error('Organisasi demo gagal dibuat.');

      const adminUser = DEMO_USERS[0]!;
      const adminId = userIds.get(adminUser.fallbackEmail)!;

      await tx.insert(users).values(
        DEMO_USERS.map((u) => ({
          id: userIds.get(u.fallbackEmail)!,
          orgId: org.id,
          email: process.env[u.envEmailKey] ?? u.fallbackEmail,
          fullName: u.fullName,
          globalRole: u.globalRole,
        })),
      );

      const unitRows = await tx
        .insert(units)
        .values(
          DEMO_UNITS.map((u) => ({
            orgId: org.id,
            code: u.code,
            name: u.name,
            dimension: u.dimension,
            createdBy: adminId,
            updatedBy: adminId,
          })),
        )
        .returning({ id: units.id, code: units.code });
      const unitId = new Map(unitRows.map((u) => [u.code, u.id]));

      const resourceRows = await tx
        .insert(resources)
        .values(
          DEMO_RESOURCES.map((r) => ({
            orgId: org.id,
            code: r.code,
            name: r.name,
            spec: r.spec ?? null,
            unitId: unitId.get(r.unit)!,
            type: r.type,
            leadTimeDays: r.leadTimeDays ?? 0,
            createdBy: adminId,
            updatedBy: adminId,
          })),
        )
        .returning({ id: resources.id, code: resources.code });
      const resourceId = new Map(resourceRows.map((r) => [r.code, r.id]));

      // Organisation-default price book (project_id NULL), effective from the
      // project start date. Project overrides are exercised in phase 2.
      await tx.insert(resourcePrices).values(
        DEMO_RESOURCES.flatMap((r) => [
          {
            resourceId: resourceId.get(r.code)!,
            projectId: null,
            priceType: 'RAB' as const,
            price: r.priceRab,
            effectiveFrom: DEMO_PROJECT.startDate,
            source: 'Seed demo',
            createdBy: adminId,
            updatedBy: adminId,
          },
          {
            resourceId: resourceId.get(r.code)!,
            projectId: null,
            priceType: 'RAP' as const,
            price: r.priceRap,
            effectiveFrom: DEMO_PROJECT.startDate,
            source: 'Seed demo',
            createdBy: adminId,
            updatedBy: adminId,
          },
        ]),
      );

      const [project] = await tx
        .insert(projects)
        .values({
          orgId: org.id,
          ...DEMO_PROJECT,
          progressWeightBasis: 'CONTRACT',
          costRecognition: 'PURCHASE_BASED',
          createdBy: adminId,
          updatedBy: adminId,
        })
        .returning({ id: projects.id });
      if (!project) throw new Error('Proyek demo gagal dibuat.');

      await tx.insert(projectMembers).values(
        DEMO_USERS.map((u) => ({
          projectId: project.id,
          userId: userIds.get(u.fallbackEmail)!,
          role: u.projectRole,
          createdBy: adminId,
          updatedBy: adminId,
        })),
      );

      const groupRows = await tx
        .insert(workGroups)
        .values(
          DEMO_GROUPS.map((g, i) => ({
            projectId: project.id,
            code: g.code,
            name: g.name,
            sortOrder: i,
            createdBy: adminId,
            updatedBy: adminId,
          })),
        )
        .returning({ id: workGroups.id, code: workGroups.code });
      const groupId = new Map(groupRows.map((g) => [g.code, g.id]));

      const itemRows = await tx
        .insert(workItems)
        .values(
          DEMO_WORK_ITEMS.map((w, i) => ({
            projectId: project.id,
            groupId: groupId.get(w.group)!,
            code: w.code,
            name: w.name,
            unitId: unitId.get(w.unit)!,
            volume: w.volume,
            contractUnitPrice: w.contractUnitPrice,
            progressMethod: w.progressMethod,
            includeInProgressWeight: w.includeInProgressWeight,
            sortOrder: i,
            createdBy: adminId,
            updatedBy: adminId,
          })),
        )
        .returning({ id: workItems.id, code: workItems.code });
      const itemId = new Map(itemRows.map((w) => [w.code, w.id]));

      await tx.insert(workItemResources).values(
        DEMO_WORK_ITEMS.flatMap((w) =>
          w.lines.map((line, i) => ({
            workItemId: itemId.get(w.code)!,
            resourceId: resourceId.get(line.resource)!,
            role: line.role,
            coefRab: line.coefRab,
            coefRap: line.coefRap,
            wasteFactor: line.wasteFactor ?? '0',
            sortOrder: i,
            createdBy: adminId,
            updatedBy: adminId,
          })),
        ),
      );

      return { projectId: project.id, userCount: DEMO_USERS.length };
    });

    printVerification();

    console.log('');
    console.log(`Proyek demo siap: /projects/${summary.projectId}`);
    if (canSignIn) {
      console.log('Akun demo (kata sandi dari SEED_ADMIN_PASSWORD):');
      for (const u of DEMO_USERS) {
        console.log(`  ${process.env[u.envEmailKey] ?? u.fallbackEmail}  —  ${u.projectRole}`);
      }
    } else {
      console.warn(
        'PERINGATAN: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SEED_ADMIN_PASSWORD belum diisi,\n' +
          'sehingga akun Supabase Auth tidak dibuat dan pengguna demo BELUM BISA login.\n' +
          'Isi ketiganya di .env.local lalu jalankan: npm run db:seed -- --reset',
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Recomputes the demo figures through `lib/calc` and prints them, so the
 * numbers on screen can be checked against a calculator by hand.
 */
function printVerification(): void {
  const priceOf = new Map(DEMO_RESOURCES.map((r) => [r.code, r]));

  const rows = DEMO_WORK_ITEMS.map((item) => {
    const lines: EstimateLine[] = item.lines.map((l) => {
      const resource = priceOf.get(l.resource)!;
      return {
        coefRab: l.coefRab,
        coefRap: l.coefRap,
        wasteFactor: l.wasteFactor ?? '0',
        priceRab: resource.priceRab,
        priceRap: resource.priceRap,
      };
    });

    const estimate = estimateWorkItem({
      volume: item.volume,
      lines,
      contractUnitPrice: item.contractUnitPrice,
    });

    return { item, estimate };
  });

  const weightInput: WeightInput[] = rows.map(({ item, estimate }) => ({
    id: item.code,
    contractValue: estimate.contractValue,
    totalRab: estimate.totalRab,
    totalRap: estimate.totalRap,
    includeInProgressWeight: item.includeInProgressWeight,
  }));

  const weights = new Map(computeWeights(weightInput, 'CONTRACT').map((w) => [w.id, w.weight]));

  console.log('');
  console.log('Verifikasi angka demo (dihitung ulang lewat lib/calc):');
  console.log('');
  console.log(
    ['Kode', 'Volume', 'RAB', 'RAP', 'Kontrak', 'Margin', 'Bobot'].map((h) => h.padEnd(16)).join(''),
  );

  for (const { item, estimate } of rows) {
    console.log(
      [
        item.code,
        `${item.volume} ${item.unit}`,
        formatCurrency(estimate.totalRab),
        formatCurrency(estimate.totalRap),
        formatCurrency(estimate.contractValue),
        formatCurrency(estimate.margin),
        formatPercent(weights.get(item.code) ?? 0),
      ]
        .map((c) => c.padEnd(16))
        .join(''),
    );
  }

  const totalRap = rows.reduce((acc, r) => acc.plus(r.estimate.totalRap), rows[0]!.estimate.totalRap.times(0));
  const reconciliation = reconcileContractValue(
    rows.map((r) => ({ contractValue: r.estimate.contractValue })),
    DEMO_PROJECT.contractValue,
  );

  console.log('');
  console.log(`  Σ nilai kontrak pekerjaan : ${formatCurrency(reconciliation.sumOfWorkItemContractValues)}`);
  console.log(`  Nilai kontrak proyek      : ${formatCurrency(reconciliation.declaredContractValue)}`);
  console.log(`  Selisih rekonsiliasi      : ${formatCurrency(reconciliation.difference)}`);
  console.log(`  Σ RAP                     : ${formatCurrency(totalRap)}`);
  console.log(
    `  Margin proyek             : ${formatCurrency(reconciliation.declaredContractValue.minus(totalRap))}`,
  );
  console.log(`  Perlu perhatian           : ${reconciliation.needsAttention ? 'YA' : 'tidak'}`);
}

main().catch((error: unknown) => {
  console.error('Seed gagal.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
