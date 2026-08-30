import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';

import type * as SubcontractsModule from '../subcontracts';
import type { SessionUser } from '../session';

/**
 * Piecework, end to end.
 *
 * Four numbers decide whether a foreman is paid correctly, and each one is a
 * place a paper system gets it wrong: the measurement, the retention, the
 * advance recovery, and the ceiling that stops the same work being certified
 * twice. The fifth thing checked here is the one a paper system cannot do at
 * all — the certified value landing on the work item as cost.
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
      WHERE table_schema = 'public' AND table_name = 'subcontract_certificate_lines'
    `;
    return rows[0]?.n === 1;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[BORONGAN] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('borongan mandor', () => {
  let sql: postgres.Sql;
  let service: typeof SubcontractsModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const periodId = randomUUID();
  const itemA = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `borongan-${userId}@uji.test`,
    fullName: 'Manajer Uji',
    globalRole: 'ADMIN',
  };

  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(
      [
        'BEGIN',
        "SELECT set_config('app.bypass_rls', 'on', true)",
        "SELECT set_config('app.allow_hard_delete', 'on', true)",
        `DELETE FROM subcontract_certificates WHERE subcontract_id IN
           (SELECT id FROM subcontracts WHERE project_id = '${projectId}')`,
        `DELETE FROM projects WHERE org_id = '${orgId}'`,
        `DELETE FROM units WHERE org_id = '${orgId}'`,
        `DELETE FROM users WHERE org_id = '${orgId}'`,
        `DELETE FROM organizations WHERE id = '${orgId}'`,
        `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Borongan (uji)')`,
        `INSERT INTO users (id, org_id, email, full_name, global_role)
           VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN')`,
        `INSERT INTO units (id, org_id, code, name, dimension)
           VALUES ('${unitId}', '${orgId}', 'm2', 'meter persegi', 'AREA')`,
        `INSERT INTO projects (id, org_id, code, name, start_date, end_date)
           VALUES ('${projectId}', '${orgId}', 'BRG-1', 'Proyek Borongan', '2026-01-01', '2026-12-31')`,
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
        `INSERT INTO schedule_periods (id, project_id, seq, period_type, label, start_date, end_date)
           VALUES ('${periodId}', '${projectId}', 1, 'WEEK', 'Minggu 1', '2026-01-01', '2026-01-07')`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume, sort_order)
           VALUES ('${itemA}', '${projectId}', 'A.01', 'Pasang keramik', '${unitId}', 500, 0)`,
        'COMMIT',
      ].join(';\n'),
    ).simple();
  };

  /** A unit-rate contract: 400 m2 at Rp50.000, 10% retention. */
  const contract = (retention = '0.1') =>
    service.saveSubcontract(user, projectId, null, {
      partyName: 'Mandor Slamet',
      scope: 'Pemasangan keramik lantai',
      contractType: 'UNIT_RATE',
      contractValue: '0',
      retentionPercent: retention,
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      status: 'ACTIVE',
      note: null,
      items: [
        {
          workItemId: itemA,
          description: 'Pasang keramik 60x60',
          qty: '400',
          unitId,
          unitRate: '50000',
        },
      ],
    });

  const firstItemId = async (subcontractId: string): Promise<string> => {
    const detail = await service.getSubcontract(userId, projectId, subcontractId);
    return detail.items[0]!.id;
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../subcontracts');
  });

  beforeEach(buildFixture);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM subcontract_certificates WHERE subcontract_id IN
        (SELECT id FROM subcontracts WHERE project_id = '${projectId}');
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';
      COMMIT;
    `).simple();
    await sql.end();
  });

  /*
   * A quantity, a rate and a total typed separately are three chances to
   * disagree, and the one a foreman argues from is whichever is larger.
   */
  it('menurunkan nilai kontrak dari kuantitas kali harga satuan', async () => {
    const { id } = await contract();
    const detail = await service.getSubcontract(userId, projectId, id);

    expect(detail.items[0]?.amount).toBe('20000000.00');
    expect(detail.contractValue).toBe('20000000.00');
  });

  // A lump sum is worth what was agreed, whatever the itemisation adds up to.
  it('tidak menimpa nilai kontrak lumpsum dengan jumlah rinciannya', async () => {
    const { id } = await service.saveSubcontract(user, projectId, null, {
      partyName: 'Mandor Budi',
      scope: 'Bongkaran',
      contractType: 'LUMPSUM',
      contractValue: '15000000',
      retentionPercent: '0',
      startDate: null,
      endDate: null,
      status: 'ACTIVE',
      note: null,
      items: [
        { workItemId: null, description: 'Bongkar dinding', qty: '1', unitId: null, unitRate: '9000000' },
      ],
    });

    expect((await service.getSubcontract(userId, projectId, id)).contractValue).toBe('15000000.00');
  });

  it('menghitung retensi dan nilai bersih sertifikat', async () => {
    const { id } = await contract('0.1');
    const itemId = await firstItemId(id);

    const cert = await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '0',
      lines: [{ subcontractItemId: itemId, qty: '100' }],
    });

    // 100 x 50.000 = 5.000.000, retensi 10% = 500.000, bersih 4.500.000.
    expect(cert.netPayable).toBe('4500000.00');

    const detail = await service.getSubcontract(userId, projectId, id);
    expect(detail.certificates[0]?.progressValue).toBe('5000000.00');
    expect(detail.certificates[0]?.retentionWithheld).toBe('500000.00');
  });

  it('memotong kasbon dari nilai bersih', async () => {
    const { id } = await contract('0');
    await service.recordAdvance(user, projectId, id, {
      advanceDate: '2026-01-05',
      amount: '2000000',
      note: 'Kasbon awal',
    });

    const itemId = await firstItemId(id);
    const cert = await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '2000000',
      lines: [{ subcontractItemId: itemId, qty: '100' }],
    });

    expect(cert.netPayable).toBe('3000000.00');
  });

  /*
   * Recovering more than was ever advanced turns a debt into a credit nobody
   * agreed to, and the foreman is the one who notices last.
   */
  it('menolak potongan kasbon melebihi sisa yang belum dikembalikan', async () => {
    const { id } = await contract('0');
    await service.recordAdvance(user, projectId, id, {
      advanceDate: '2026-01-05',
      amount: '1000000',
      note: null,
    });

    const itemId = await firstItemId(id);
    await expect(
      service.createCertificate(user, projectId, id, {
        periodId,
        certNo: 'SC-01',
        certDate: '2026-01-31',
        advanceRecouped: '5000000',
        lines: [{ subcontractItemId: itemId, qty: '100' }],
      }),
    ).rejects.toThrow(/belum dikembalikan/);
  });

  /*
   * The ceiling is cumulative. Checked in the service rather than the form,
   * because the form does not know what other certificates exist.
   */
  it('menolak sertifikasi melebihi sisa kuantitas kontrak', async () => {
    const { id } = await contract('0');
    const itemId = await firstItemId(id);

    await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '0',
      lines: [{ subcontractItemId: itemId, qty: '350' }],
    });
    await service.approveCertificate(
      user,
      projectId,
      (await service.getSubcontract(userId, projectId, id)).certificates[0]!.id,
    );

    await expect(
      service.createCertificate(user, projectId, id, {
        periodId,
        certNo: 'SC-02',
        certDate: '2026-02-28',
        advanceRecouped: '0',
        lines: [{ subcontractItemId: itemId, qty: '100' }],
      }),
    ).rejects.toThrow(/menyisakan/);
  });

  /*
   * The thing a paper system cannot do: the certified value landing on the
   * work item as cost, so cost control sees the foreman's money.
   */
  it('membukukan nilai sertifikat sebagai biaya pekerjaan saat disetujui', async () => {
    const { id } = await contract('0.1');
    const itemId = await firstItemId(id);

    await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '0',
      lines: [{ subcontractItemId: itemId, qty: '100' }],
    });

    const certId = (await service.getSubcontract(userId, projectId, id)).certificates[0]!.id;
    await service.approveCertificate(user, projectId, certId);

    const costs = await import('../costs');
    const control = await costs.getCostControl(userId, projectId);
    const row = control.rows.find((r) => r.code === 'A.01');

    // The gross measurement, not the net payment: retention is money withheld,
    // not work that was never done.
    expect(row?.actualBooked).toBe('5000000.00');
  });

  it('tidak menggandakan biaya bila sertifikat disetujui dua kali', async () => {
    const { id } = await contract('0');
    const itemId = await firstItemId(id);

    await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '0',
      lines: [{ subcontractItemId: itemId, qty: '100' }],
    });

    const certId = (await service.getSubcontract(userId, projectId, id)).certificates[0]!.id;
    await service.approveCertificate(user, projectId, certId);
    await service.approveCertificate(user, projectId, certId);

    const costs = await import('../costs');
    const control = await costs.getCostControl(userId, projectId);
    expect(control.rows.find((r) => r.code === 'A.01')?.actualBooked).toBe('5000000.00');
  });

  it('menghapus biaya yang dibukukan ketika sertifikatnya dihapus', async () => {
    const { id } = await contract('0');
    const itemId = await firstItemId(id);

    await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '0',
      lines: [{ subcontractItemId: itemId, qty: '100' }],
    });

    const certId = (await service.getSubcontract(userId, projectId, id)).certificates[0]!.id;
    await service.approveCertificate(user, projectId, certId);
    await service.deleteCertificate(user, projectId, certId);

    const costs = await import('../costs');
    const control = await costs.getCostControl(userId, projectId);
    expect(control.rows.find((r) => r.code === 'A.01')?.actualBooked).toBe('0.00');
  });

  it('menolak menghapus sertifikat yang sudah dibayar', async () => {
    const { id } = await contract('0');
    const itemId = await firstItemId(id);

    await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '0',
      lines: [{ subcontractItemId: itemId, qty: '100' }],
    });

    const certId = (await service.getSubcontract(userId, projectId, id)).certificates[0]!.id;
    await service.approveCertificate(user, projectId, certId);
    await service.markCertificatePaid(user, projectId, certId, '2026-02-05');

    await expect(service.deleteCertificate(user, projectId, certId)).rejects.toThrow(
      /sudah dibayar/,
    );
  });

  it('menolak mencatat pembayaran sebelum sertifikatnya disetujui', async () => {
    const { id } = await contract('0');
    const itemId = await firstItemId(id);

    await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '0',
      lines: [{ subcontractItemId: itemId, qty: '100' }],
    });

    const certId = (await service.getSubcontract(userId, projectId, id)).certificates[0]!.id;
    await expect(
      service.markCertificatePaid(user, projectId, certId, '2026-02-05'),
    ).rejects.toThrow(/belum disetujui/);
  });

  it('melacak sisa kasbon yang belum dikembalikan', async () => {
    const { id } = await contract('0');
    await service.recordAdvance(user, projectId, id, {
      advanceDate: '2026-01-05',
      amount: '3000000',
      note: null,
    });

    const itemId = await firstItemId(id);
    await service.createCertificate(user, projectId, id, {
      periodId,
      certNo: 'SC-01',
      certDate: '2026-01-31',
      advanceRecouped: '1000000',
      lines: [{ subcontractItemId: itemId, qty: '100' }],
    });
    await service.approveCertificate(
      user,
      projectId,
      (await service.getSubcontract(userId, projectId, id)).certificates[0]!.id,
    );

    const detail = await service.getSubcontract(userId, projectId, id);
    expect(detail.advancesPaid).toBe('3000000.00');
    expect(detail.advancesRecouped).toBe('1000000.00');
    expect(detail.advanceOutstanding).toBe('2000000.00');
  });

  /*
   * Numbers people quote to each other have to be unique, and left to people
   * they are not: two site staff both type SC-02 on the same afternoon and
   * neither finds out until the foreman asks which one he is being paid on.
   */
  describe('penomoran dokumen', () => {
    it('memberi nomor berurutan saat nomornya dikosongkan', async () => {
      const { id } = await contract('0');
      const itemId = await firstItemId(id);

      await service.createCertificate(user, projectId, id, {
        periodId, certNo: '', certDate: '2026-01-31', advanceRecouped: '0',
        lines: [{ subcontractItemId: itemId, qty: '10' }],
      });
      await service.createCertificate(user, projectId, id, {
        periodId, certNo: '', certDate: '2026-02-28', advanceRecouped: '0',
        lines: [{ subcontractItemId: itemId, qty: '10' }],
      });

      const detail = await service.getSubcontract(userId, projectId, id);
      expect(detail.certificates.map((c) => c.certNo).sort()).toEqual(['SC-001', 'SC-002']);
    });

    // A document that arrives with the other party's own reference keeps it.
    it('mempertahankan nomor yang diisi sendiri', async () => {
      const { id } = await contract('0');
      const itemId = await firstItemId(id);

      await service.createCertificate(user, projectId, id, {
        periodId, certNo: 'BA-LAPANGAN-7', certDate: '2026-01-31', advanceRecouped: '0',
        lines: [{ subcontractItemId: itemId, qty: '10' }],
      });

      const detail = await service.getSubcontract(userId, projectId, id);
      expect(detail.certificates[0]?.certNo).toBe('BA-LAPANGAN-7');
    });

    /*
     * The counter must not advance for a certificate that never saved, or the
     * series ends up full of holes nobody can explain to an auditor.
     */
    it('tidak menghabiskan nomor pada sertifikat yang gagal disimpan', async () => {
      const { id } = await contract('0');
      const itemId = await firstItemId(id);

      await expect(
        service.createCertificate(user, projectId, id, {
          periodId, certNo: '', certDate: '2026-01-31', advanceRecouped: '0',
          lines: [{ subcontractItemId: itemId, qty: '9999' }],
        }),
      ).rejects.toThrow();

      await service.createCertificate(user, projectId, id, {
        periodId, certNo: '', certDate: '2026-01-31', advanceRecouped: '0',
        lines: [{ subcontractItemId: itemId, qty: '10' }],
      });

      const detail = await service.getSubcontract(userId, projectId, id);
      expect(detail.certificates[0]?.certNo).toBe('SC-001');
    });
  });
});
