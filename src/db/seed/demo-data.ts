/**
 * Demo dataset — a small but real warehouse project.
 *
 * Every figure here is chosen so a reader can check it with a calculator:
 * the seed prints a reconciliation table at the end, and the numbers below are
 * the ones it must reproduce. This is the only place demo values are allowed
 * to exist (charter rule 1); nothing in the application ships with data.
 */

export const DEMO_ORG_NAME = 'PT Demo Konstruksi Nusantara';

export type DemoUnit = {
  code: string;
  name: string;
  dimension: 'LENGTH' | 'AREA' | 'VOLUME' | 'MASS' | 'COUNT' | 'TIME' | 'LUMPSUM';
};

export const DEMO_UNITS: DemoUnit[] = [
  { code: 'm', name: 'Meter', dimension: 'LENGTH' },
  { code: 'm2', name: 'Meter persegi', dimension: 'AREA' },
  { code: 'm3', name: 'Meter kubik', dimension: 'VOLUME' },
  { code: 'kg', name: 'Kilogram', dimension: 'MASS' },
  { code: 'zak', name: 'Zak', dimension: 'COUNT' },
  { code: 'OH', name: 'Orang-hari', dimension: 'TIME' },
  { code: 'jam', name: 'Jam', dimension: 'TIME' },
  { code: 'bln', name: 'Bulan', dimension: 'TIME' },
  { code: 'ls', name: 'Lumpsum', dimension: 'LUMPSUM' },
];

export type DemoResource = {
  code: string;
  name: string;
  spec?: string;
  unit: string;
  type: 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCON' | 'PACKAGE' | 'OVERHEAD';
  priceRab: string;
  priceRap: string;
  leadTimeDays?: number;
};

export const DEMO_RESOURCES: DemoResource[] = [
  { code: 'L.01', name: 'Pekerja', unit: 'OH', type: 'LABOR', priceRab: '120000', priceRap: '115000' },
  { code: 'L.02', name: 'Tukang batu', unit: 'OH', type: 'LABOR', priceRab: '150000', priceRap: '145000' },
  { code: 'L.03', name: 'Mandor', unit: 'OH', type: 'LABOR', priceRab: '180000', priceRap: '175000' },

  {
    code: 'M.01',
    name: 'Semen portland',
    spec: 'PC 40 kg',
    unit: 'zak',
    type: 'MATERIAL',
    priceRab: '50000',
    priceRap: '48000',
    leadTimeDays: 3,
  },
  { code: 'M.02', name: 'Pasir beton', unit: 'm3', type: 'MATERIAL', priceRab: '300000', priceRap: '285000', leadTimeDays: 2 },
  { code: 'M.03', name: 'Batu pecah', spec: '2/3', unit: 'm3', type: 'MATERIAL', priceRab: '350000', priceRap: '335000', leadTimeDays: 2 },
  { code: 'M.04', name: 'Besi beton polos', spec: 'BjTP 280', unit: 'kg', type: 'MATERIAL', priceRab: '16000', priceRap: '15500', leadTimeDays: 7 },
  { code: 'M.05', name: 'Bata ringan', spec: '600 x 200 x 100 mm', unit: 'm3', type: 'MATERIAL', priceRab: '750000', priceRap: '720000', leadTimeDays: 5 },

  { code: 'E.01', name: 'Concrete mixer', spec: '0,3 m3', unit: 'jam', type: 'EQUIPMENT', priceRab: '85000', priceRap: '80000' },

  {
    code: 'PK.01',
    name: 'Operasional lapangan',
    spec: 'direksi keet, listrik, air, keamanan — per bulan',
    unit: 'bln',
    type: 'PACKAGE',
    priceRab: '15000000',
    priceRap: '14000000',
  },
];

export type DemoAhspLine = {
  resource: string;
  role: 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCON' | 'PACKAGE';
  coefRab: string;
  coefRap: string;
  wasteFactor?: string;
};

export type DemoWorkItem = {
  code: string;
  name: string;
  group: string;
  unit: string;
  volume: string;
  /** null exercises the fallback: RAB x (1 + markup). */
  contractUnitPrice: string | null;
  progressMethod: 'VOLUME' | 'PERCENT' | 'MILESTONE';
  includeInProgressWeight: boolean;
  lines: DemoAhspLine[];
};

export const DEMO_GROUPS = [
  { code: 'A', name: 'Pekerjaan Struktur' },
  { code: 'B', name: 'Pekerjaan Arsitektur' },
  { code: 'Z', name: 'Operasional Proyek' },
];

export const DEMO_WORK_ITEMS: DemoWorkItem[] = [
  {
    code: 'A.01',
    name: 'Beton mutu K-225',
    group: 'A',
    unit: 'm3',
    volume: '100',
    contractUnitPrice: '1250000',
    progressMethod: 'VOLUME',
    includeInProgressWeight: true,
    lines: [
      // 100 m3 x 8 zak x Rp48.000 = Rp38.400.000 — the charter's worked example.
      { resource: 'M.01', role: 'MATERIAL', coefRab: '8', coefRap: '8' },
      { resource: 'M.02', role: 'MATERIAL', coefRab: '0.5', coefRap: '0.5' },
      { resource: 'M.03', role: 'MATERIAL', coefRab: '0.8', coefRap: '0.8' },
      { resource: 'L.01', role: 'LABOR', coefRab: '1.65', coefRap: '1.65' },
      { resource: 'L.02', role: 'LABOR', coefRab: '0.275', coefRap: '0.275' },
      { resource: 'L.03', role: 'LABOR', coefRab: '0.083', coefRap: '0.083' },
      { resource: 'E.01', role: 'EQUIPMENT', coefRab: '0.5', coefRap: '0.5' },
    ],
  },
  {
    code: 'A.02',
    name: 'Pembesian besi polos',
    group: 'A',
    unit: 'kg',
    volume: '12000',
    contractUnitPrice: '22000',
    progressMethod: 'VOLUME',
    includeInProgressWeight: true,
    lines: [
      // Waste is a separate factor, not folded into the coefficient, so the
      // 5% overage stays visible and adjustable.
      { resource: 'M.04', role: 'MATERIAL', coefRab: '1', coefRap: '1', wasteFactor: '0.05' },
      { resource: 'L.01', role: 'LABOR', coefRab: '0.007', coefRap: '0.007' },
      { resource: 'L.02', role: 'LABOR', coefRab: '0.007', coefRap: '0.007' },
    ],
  },
  {
    code: 'B.01',
    name: 'Pasangan dinding bata ringan',
    group: 'B',
    unit: 'm2',
    volume: '450',
    contractUnitPrice: '185000',
    progressMethod: 'VOLUME',
    includeInProgressWeight: true,
    lines: [
      { resource: 'M.05', role: 'MATERIAL', coefRab: '0.085', coefRap: '0.085' },
      { resource: 'M.01', role: 'MATERIAL', coefRab: '0.15', coefRap: '0.15' },
      { resource: 'L.01', role: 'LABOR', coefRab: '0.3', coefRap: '0.3' },
      { resource: 'L.02', role: 'LABOR', coefRab: '0.15', coefRap: '0.15' },
    ],
  },
  {
    code: 'Z.01',
    name: 'Operasional lapangan',
    group: 'Z',
    unit: 'bln',
    volume: '6',
    // Not billed as a separate line, but it costs real money — so it carries
    // cost without carrying progress weight (design decision 3).
    contractUnitPrice: '0',
    progressMethod: 'PERCENT',
    includeInProgressWeight: false,
    lines: [{ resource: 'PK.01', role: 'PACKAGE', coefRab: '1', coefRap: '1' }],
  },
];

export const DEMO_PROJECT = {
  code: 'DEMO-2026-01',
  name: 'Pembangunan Gudang Logistik Cikarang',
  contractNo: '027/SPK/DEMO/I/2026',
  ownerName: 'PT Sinar Logistik Utama',
  contractorName: DEMO_ORG_NAME,
  location: 'Cikarang, Kabupaten Bekasi',
  projectType: 'Gedung',
  /** Equals the sum of volume x contract_unit_price across all work items. */
  contractValue: '472250000',
  startDate: '2026-02-02',
  endDate: '2026-07-31',
  periodType: 'WEEK' as const,
  retentionPercent: '0.05',
  retentionReleaseDays: 180,
  vatPercent: '0.11',
  whtPercent: '0.0175',
  status: 'ACTIVE' as const,
};

export type DemoUser = {
  envEmailKey: string;
  fallbackEmail: string;
  fullName: string;
  globalRole: 'ADMIN' | 'MEMBER';
  projectRole: 'PROJECT_MANAGER' | 'ENGINEER' | 'FIELD_USER' | 'VIEWER';
};

export const DEMO_USERS: DemoUser[] = [
  {
    /*
     * A real mailbox, unlike the other two.
     *
     * The master account is the one that has to receive things — approval
     * notices, a reset link — so a `.test` address that no server will ever
     * deliver to makes exactly the account that needs mail the one that cannot
     * get any. `SEED_ADMIN_EMAIL` still overrides it per deployment.
     */
    envEmailKey: 'SEED_ADMIN_EMAIL',
    fallbackEmail: 'ramadhandimasnur@gmail.com',
    fullName: 'Dimas Nur Ramadhan',
    globalRole: 'ADMIN',
    projectRole: 'PROJECT_MANAGER',
  },
  {
    envEmailKey: 'SEED_ENGINEER_EMAIL',
    fallbackEmail: 'engineer@demo.test',
    fullName: 'Sari Wulandari',
    globalRole: 'MEMBER',
    projectRole: 'ENGINEER',
  },
  {
    envEmailKey: 'SEED_FIELD_EMAIL',
    fallbackEmail: 'lapangan@demo.test',
    fullName: 'Bagus Nugroho',
    globalRole: 'MEMBER',
    projectRole: 'FIELD_USER',
  },
];
