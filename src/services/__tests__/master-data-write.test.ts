import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as PricesModule from '../prices';
import type * as ResourcesModule from '../resources';
import type { SessionUser } from '../session';
import type * as SuppliersModule from '../suppliers';
import type * as UnitsModule from '../units';

/**
 * Integration tests for the master-data write path.
 *
 * The Zod schemas cover what the user typed and the database covers what must
 * be true of any row. This file covers the layer between them: the rules that
 * need other rows to decide — uniqueness, whether a unit is already in use,
 * who is allowed to write at all. Those are the rules a form cannot check and
 * a constraint cannot express.
 *
 * Skips itself when no database is reachable.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

async function schemaIsReady(): Promise<boolean> {
  if (!url) return false;
  const probe = postgres(connectionOptions(url, { max: 1, prepare: false, connect_timeout: 5 }));
  try {
    const rows = await probe`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('resources', 'units', 'suppliers')
    `;
    return rows[0]?.n === 3;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) {
  console.warn('[master data] Dilewati: database belum tersedia. Jalankan npm run db:setup.');
}

describe.skipIf(!ready)('master data — jalur tulis', () => {
  let sql: postgres.Sql;
  // Imported lazily in beforeAll so the modules — and their database pool —
  // are never constructed when the suite is skipped.
  let units: typeof UnitsModule;
  let resources: typeof ResourcesModule;
  let suppliers: typeof SuppliersModule;
  let prices: typeof PricesModule;

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const adminId = randomUUID();
  const memberId = randomUUID();

  const admin: SessionUser = {
    id: adminId,
    orgId,
    email: `admin-${adminId}@uji.test`,
    fullName: 'Admin Uji',
    globalRole: 'ADMIN',
  };
  const member: SessionUser = {
    id: memberId,
    orgId,
    email: `member-${memberId}@uji.test`,
    fullName: 'Anggota Uji',
    globalRole: 'MEMBER',
  };

  /** A unit in the *other* organisation, to prove scoping. */
  let foreignUnitId: string;

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    [units, resources, suppliers, prices] = await Promise.all([
      import('../units'),
      import('../resources'),
      import('../suppliers'),
      import('../prices'),
    ]);
  });

  /**
   * Teardown and setup in a single simple-protocol round trip.
   *
   * Statement-per-await against a hosted database costs a network hop each;
   * twelve of them per test dominated the suite's runtime. Every value
   * interpolated here is a generated uuid or a literal owned by this file.
   */
  const resetFixture = async (): Promise<void> => {
    foreignUnitId = randomUUID();

    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);

      DELETE FROM projects            WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM suppliers           WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM resources           WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM resource_categories WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM units               WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM users               WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM organizations       WHERE id     IN ('${orgId}', '${otherOrgId}');

      INSERT INTO organizations (id, name)
      VALUES ('${orgId}', 'Org Tulis (uji)'), ('${otherOrgId}', 'Org Lain (uji)');

      INSERT INTO users (id, org_id, email, full_name, global_role) VALUES
        ('${adminId}',  '${orgId}', '${admin.email}',  '${admin.fullName}',  'ADMIN'),
        ('${memberId}', '${orgId}', '${member.email}', '${member.fullName}', 'MEMBER');

      INSERT INTO units (id, org_id, code, name, dimension)
      VALUES ('${foreignUnitId}', '${otherOrgId}', 'asing', 'Satuan Asing', 'COUNT');
      COMMIT;
    `).simple();
  };

  beforeEach(resetFixture);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects            WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM suppliers           WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM resources           WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM resource_categories WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM units               WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM users               WHERE org_id IN ('${orgId}', '${otherOrgId}');
      DELETE FROM organizations       WHERE id     IN ('${orgId}', '${otherOrgId}');
      COMMIT;
    `).simple();
    await sql.end();
  });

  const makeUnit = async (code = 'm3', dimension: 'VOLUME' | 'MASS' | 'COUNT' = 'VOLUME') =>
    (await units.createUnit(admin, { code, name: code.toUpperCase(), dimension })).id;

  const makeResource = async (unitId: string, code = 'M.01') =>
    (
      await resources.createResource(admin, {
        code,
        name: 'semen',
        type: 'MATERIAL',
        unitId,
      })
    ).id;

  // -------------------------------------------------------------------------
  describe('otorisasi', () => {
    it('menolak anggota biasa membuat satuan, sumber daya, dan pemasok', async () => {
      await expect(
        units.createUnit(member, { code: 'x', name: 'X', dimension: 'COUNT' }),
      ).rejects.toThrow(/administrator organisasi/i);

      const unitId = await makeUnit();
      await expect(
        resources.createResource(member, { code: 'X.01', name: 'x', type: 'MATERIAL', unitId }),
      ).rejects.toThrow(/administrator organisasi/i);

      await expect(
        suppliers.createSupplier(member, { code: 'S1', name: 'Pemasok' }),
      ).rejects.toThrow(/administrator organisasi/i);
    });

    it('menolak anggota biasa menetapkan harga default organisasi', async () => {
      const unitId = await makeUnit();
      const resourceId = await makeResource(unitId);

      await expect(
        prices.setPrice(member, {
          resourceId,
          projectId: null,
          priceType: 'RAP',
          price: '1000.00',
          effectiveFrom: '2026-03-01',
        }),
      ).rejects.toThrow(/administrator organisasi/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('satuan', () => {
    it('membuat dan memperbarui satuan', async () => {
      const id = await makeUnit('kg', 'MASS');
      await units.updateUnit(admin, id, { code: 'kg', name: 'Kilogram', dimension: 'MASS' });

      const list = await units.listUnits(adminId);
      expect(list.find((u) => u.id === id)?.name).toBe('Kilogram');
    });

    it('menolak kode yang sudah dipakai', async () => {
      await makeUnit('m3');
      await expect(
        units.createUnit(admin, { code: 'm3', name: 'Duplikat', dimension: 'VOLUME' }),
      ).rejects.toThrow(/sudah dipakai/i);
    });

    // Charter rule 8: conversion only ever happens inside one dimension.
    it('menolak satuan dasar yang berbeda dimensi', async () => {
      const massId = await makeUnit('kg', 'MASS');
      await expect(
        units.createUnit(admin, {
          code: 'm3',
          name: 'Kubik',
          dimension: 'VOLUME',
          baseUnitId: massId,
          factorToBase: '1000',
        }),
      ).rejects.toThrow(/berdimensi Massa, sedangkan satuan ini Volume/i);
    });

    it('menerima satuan dasar sedimensi', async () => {
      const kgId = await makeUnit('kg', 'MASS');
      const tonId = (
        await units.createUnit(admin, {
          code: 'ton',
          name: 'Ton',
          dimension: 'MASS',
          baseUnitId: kgId,
          factorToBase: '1000',
        })
      ).id;

      const list = await units.listUnits(adminId);
      expect(list.find((u) => u.id === tonId)?.baseUnitId).toBe(kgId);
    });

    it('mengunci dimensi setelah satuan dipakai sumber daya', async () => {
      const unitId = await makeUnit('m3', 'VOLUME');
      await makeResource(unitId);

      await expect(
        units.updateUnit(admin, unitId, { code: 'm3', name: 'M3', dimension: 'MASS' }),
      ).rejects.toThrow(/tidak dapat diubah/i);
    });

    it('menolak menghapus satuan yang dipakai, dan menyebut berapa banyak', async () => {
      const unitId = await makeUnit();
      await makeResource(unitId);

      await expect(units.deleteUnit(admin, unitId)).rejects.toThrow(/dipakai oleh 1 sumber daya/i);
    });

    it('menghapus satuan yang belum dipakai', async () => {
      const unitId = await makeUnit('bh', 'COUNT');
      await units.deleteUnit(admin, unitId);

      const list = await units.listUnits(adminId);
      expect(list.find((u) => u.id === unitId)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('sumber daya', () => {
    it('membuat sumber daya dan menghitungnya di katalog', async () => {
      const unitId = await makeUnit();
      const id = await makeResource(unitId);

      const { items, total } = await resources.listResources(adminId);
      expect(total).toBe(1);
      expect(items[0]?.id).toBe(id);
      // No price yet: the catalogue shows an absence, not a zero.
      expect(items[0]?.priceRap).toBeNull();
    });

    it('menolak kode yang sudah dipakai, menyebut pemiliknya', async () => {
      const unitId = await makeUnit();
      await makeResource(unitId, 'M.01');

      await expect(
        resources.createResource(admin, {
          code: 'M.01',
          name: 'lain',
          type: 'MATERIAL',
          unitId,
        }),
      ).rejects.toThrow(/sudah dipakai oleh "semen"/i);
    });

    // Scoping: a unit belonging to another organisation must be unreachable.
    it('menolak satuan milik organisasi lain', async () => {
      await expect(
        resources.createResource(admin, {
          code: 'X.01',
          name: 'x',
          type: 'MATERIAL',
          unitId: foreignUnitId,
        }),
      ).rejects.toThrow(/tidak ditemukan di organisasi ini/i);
    });

    it('memperbarui sumber daya', async () => {
      const unitId = await makeUnit();
      const id = await makeResource(unitId);

      await resources.updateResource(admin, id, {
        code: 'M.01',
        name: 'semen portland',
        spec: 'PC 40 kg',
        type: 'MATERIAL',
        unitId,
        leadTimeDays: 3,
      });

      const detail = await resources.getResource(adminId, id);
      expect(detail.name).toBe('semen portland');
      expect(detail.spec).toBe('PC 40 kg');
      expect(detail.leadTimeDays).toBe(3);
    });

    it('menonaktifkan sumber daya tanpa menghapusnya', async () => {
      const unitId = await makeUnit();
      const id = await makeResource(unitId);

      await resources.setResourceActive(admin, id, false);

      expect((await resources.getResource(adminId, id)).isActive).toBe(false);
      // Hidden from the default listing, still present when asked for.
      expect((await resources.listResources(adminId)).total).toBe(0);
      expect((await resources.listResources(adminId, { includeInactive: true })).total).toBe(1);
    });

    it('menghapus sumber daya yang belum dipakai', async () => {
      const unitId = await makeUnit();
      const id = await makeResource(unitId);

      await resources.deleteResource(admin, id);
      await expect(resources.getResource(adminId, id)).rejects.toThrow(/tidak ditemukan/i);
    });

    describe('ketika sudah dipakai analisa pekerjaan', () => {
      let unitId: string;
      let resourceId: string;

      beforeEach(async () => {
        unitId = await makeUnit();
        resourceId = await makeResource(unitId);

        const projectId = randomUUID();
        const workItemId = randomUUID();
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx`
            INSERT INTO projects (id, org_id, code, name, start_date, end_date)
            VALUES (${projectId}, ${orgId}, 'P-UJI', 'Proyek Uji', '2026-01-01', '2026-12-31')
          `;
          await tx`
            INSERT INTO work_items (id, project_id, code, name, unit_id, volume)
            VALUES (${workItemId}, ${projectId}, 'A.01', 'Pekerjaan Uji', ${unitId}, 10)
          `;
          await tx`
            INSERT INTO work_item_resources (work_item_id, resource_id, role, coef_rab, coef_rap)
            VALUES (${workItemId}, ${resourceId}, 'MATERIAL', 8, 8)
          `;
        });
      });

      it('menolak penghapusan dan menyebut di mana ia dipakai', async () => {
        await expect(resources.deleteResource(admin, resourceId)).rejects.toThrow(
          /1 baris analisa pekerjaan/i,
        );
      });

      // Rewriting the unit would reinterpret every coefficient recorded here.
      it('menolak perubahan satuan', async () => {
        const otherUnit = await makeUnit('kg', 'MASS');

        await expect(
          resources.updateResource(admin, resourceId, {
            code: 'M.01',
            name: 'semen',
            type: 'MATERIAL',
            unitId: otherUnit,
          }),
        ).rejects.toThrow(/Satuan "m3" tidak dapat diubah/i);
      });

      it('tetap mengizinkan penonaktifan', async () => {
        await resources.setResourceActive(admin, resourceId, false);
        expect((await resources.getResource(adminId, resourceId)).isActive).toBe(false);
      });

      it('melaporkan pemakaiannya', async () => {
        const usage = await resources.countResourceUsage(resourceId);
        expect(usage.workItems).toBe(1);
        expect(usage.total).toBe(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('harga', () => {
    it('menyimpan harga dan menampilkannya di katalog', async () => {
      const unitId = await makeUnit();
      const resourceId = await makeResource(unitId);

      await prices.setPrice(admin, {
        resourceId,
        projectId: null,
        priceType: 'RAP',
        price: '48000.00',
        effectiveFrom: '2026-03-01',
        source: 'Uji',
      });

      const { items } = await resources.listResources(adminId, { onDate: '2026-06-01' });
      expect(items[0]?.priceRap).toBe('48000.00');
    });

    it('mengganti entri pada tanggal berlaku yang sama', async () => {
      const unitId = await makeUnit();
      const resourceId = await makeResource(unitId);

      for (const price of ['48000.00', '52000.00']) {
        await prices.setPrice(admin, {
          resourceId,
          projectId: null,
          priceType: 'RAP',
          price,
          effectiveFrom: '2026-03-01',
        });
      }

      const history = await prices.listPriceHistory(adminId, resourceId);
      expect(history).toHaveLength(1);
      expect(history[0]?.price).toBe('52000.00');
    });

    // Charter section 5.7: history is never overwritten, so an old estimate
    // remains explainable.
    it('menyimpan tanggal berlaku baru sebagai entri tambahan', async () => {
      const unitId = await makeUnit();
      const resourceId = await makeResource(unitId);

      await prices.setPrice(admin, {
        resourceId, projectId: null, priceType: 'RAP', price: '48000.00', effectiveFrom: '2026-03-01',
      });
      await prices.setPrice(admin, {
        resourceId, projectId: null, priceType: 'RAP', price: '52000.00', effectiveFrom: '2026-06-01',
      });

      const history = await prices.listPriceHistory(adminId, resourceId);
      expect(history).toHaveLength(2);

      // Resolution respects the date it is asked about.
      const before = await resources.listResources(adminId, { onDate: '2026-05-31' });
      const after = await resources.listResources(adminId, { onDate: '2026-06-01' });
      expect(before.items[0]?.priceRap).toBe('48000.00');
      expect(after.items[0]?.priceRap).toBe('52000.00');
    });

    it('menolak sumber daya milik organisasi lain', async () => {
      await expect(
        prices.setPrice(admin, {
          resourceId: randomUUID(),
          projectId: null,
          priceType: 'RAP',
          price: '1000.00',
          effectiveFrom: '2026-03-01',
        }),
      ).rejects.toThrow(/tidak ditemukan/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('pemasok', () => {
    it('membuat, memperbarui, dan menghapus pemasok', async () => {
      const { id } = await suppliers.createSupplier(admin, {
        code: 'SUP-01',
        name: 'CV Sumber Bangunan',
        creditDays: 30,
      });

      await suppliers.updateSupplier(admin, id, {
        code: 'SUP-01',
        name: 'CV Sumber Bangunan Jaya',
        creditDays: 45,
      });

      let list = await suppliers.listSuppliers(adminId);
      expect(list[0]?.name).toBe('CV Sumber Bangunan Jaya');
      expect(list[0]?.creditDays).toBe(45);

      await suppliers.deleteSupplier(admin, id);
      list = await suppliers.listSuppliers(adminId);
      expect(list).toHaveLength(0);
    });

    it('menolak kode yang sudah dipakai', async () => {
      await suppliers.createSupplier(admin, { code: 'SUP-01', name: 'Pertama' });
      await expect(
        suppliers.createSupplier(admin, { code: 'SUP-01', name: 'Kedua' }),
      ).rejects.toThrow(/sudah dipakai oleh "Pertama"/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('jejak audit', () => {
    // Charter rule 9: every mutation leaves a record, in the same transaction.
    it('mencatat pembuatan sumber daya', async () => {
      const unitId = await makeUnit();
      const resourceId = await makeResource(unitId);

      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
        return tx`
          SELECT action, actor_id FROM audit_logs
          WHERE table_name = 'resources' AND record_id = ${resourceId}
        `;
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('INSERT');
      expect(rows[0]?.actor_id).toBe(adminId);
    });
  });
});
