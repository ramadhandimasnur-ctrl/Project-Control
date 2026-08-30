import {
  Banknote,
  Calculator,
  CalendarClock,
  CalendarRange,
  ClipboardCheck,
  FileBarChart,
  FileDiff,
  FileText,
  LayoutDashboard,
  Package,
  Receipt,
  Scale,
  Settings,
  Sigma,
  type LucideIcon,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';

import { canViewCosts, type ProjectRole } from '@/lib/auth/roles';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Phase that delivers the module, per charter section 9. */
  phase: number;
  /** Roles that must not see the entry at all. */
  requiresCostAccess?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

/**
 * The full module map is shown from day one, with unbuilt modules marked by
 * their delivery phase rather than hidden. A navigation tree that grows
 * silently gives no sense of where the product is going; one that 404s is
 * worse.
 */
export function projectNavSections(projectId: string): NavSection[] {
  const base = `/projects/${projectId}`;

  return [
    {
      title: 'Ringkasan',
      /*
       * Phase 1, not 8: this is the project's home page and has been reachable
       * since the beginning — clicking a project in the list lands here. It
       * grew into the executive dashboard in phase 7, but gating the entry
       * behind a later phase only ever hid a page that already worked.
       */
      items: [
        { label: 'Dashboard Eksekutif', href: base, icon: LayoutDashboard, phase: 1 },
      ],
    },
    {
      title: 'Estimasi',
      items: [
        { label: 'Pekerjaan & AHSP', href: `${base}/work-items`, icon: Sigma, phase: 3 },
        {
          label: 'RAB',
          href: `${base}/estimate/rab`,
          icon: FileBarChart,
          phase: 3,
          requiresCostAccess: true,
        },
        {
          label: 'RAP',
          href: `${base}/estimate/rap`,
          icon: Calculator,
          phase: 3,
          requiresCostAccess: true,
        },
        /*
         * Sits with the estimate rather than under Pengaturan: a change order
         * is an estimating act — volumes and money — and the person drafting
         * one has the RAB open beside it.
         */
        {
          label: 'Pekerjaan Tambah/Kurang',
          href: `${base}/cco`,
          icon: FileDiff,
          phase: 3,
          requiresCostAccess: true,
        },
      ],
    },
    {
      title: 'Jadwal',
      items: [
        { label: 'Periode & Jadwal', href: `${base}/schedule`, icon: CalendarRange, phase: 5 },
        { label: 'Kurva-S', href: `${base}/scurve`, icon: FileBarChart, phase: 5 },
      ],
    },
    {
      title: 'Pelaksanaan',
      items: [
        { label: 'Input Progres', href: `${base}/progress`, icon: ClipboardCheck, phase: 6 },
        { label: 'Kebutuhan Material', href: `${base}/material`, icon: Package, phase: 4 },
        /*
         * Separate from the material schedule on purpose: that one answers how
         * much is still needed, this one answers by when it has to be ordered.
         * Reading them together on one screen buried the deadline under stock.
         */
        {
          label: 'Rencana Pengadaan',
          href: `${base}/procurement`,
          icon: CalendarClock,
          phase: 4,
        },
        { label: 'Gudang', href: `${base}/warehouse`, icon: Warehouse, phase: 4 },
        {
          label: 'Pembelian',
          href: `${base}/purchases`,
          icon: Receipt,
          phase: 4,
          requiresCostAccess: true,
        },
      ],
    },
    {
      title: 'Keuangan',
      items: [
        { label: 'Kas & Termin', href: `${base}/cash`, icon: Wallet, phase: 7, requiresCostAccess: true },
        {
          label: 'Kebutuhan Modal',
          href: `${base}/capital`,
          icon: Banknote,
          phase: 7,
          requiresCostAccess: true,
        },
        /*
         * Cost control sits beside the money it reports on, not under
         * reporting. It is a screen somebody acts from — the item with the
         * worst CPI is the one to go and look at this week.
         */
        {
          label: 'Kendali Biaya',
          href: `${base}/costs`,
          icon: Scale,
          phase: 7,
          requiresCostAccess: true,
        },
      ],
    },
    {
      /*
       * Both report surfaces live together. The opname sheet used to sit under
       * Pelaksanaan next to the screen that feeds it, which reads sensibly
       * while building it and not at all while looking for a report.
       */
      title: 'Laporan',
      items: [
        { label: 'Laporan & Terbitan', href: `${base}/reports`, icon: FileBarChart, phase: 9 },
        { label: 'Laporan Opname', href: `${base}/reports/opname`, icon: FileText, phase: 6 },
      ],
    },
    {
      title: 'Pengaturan',
      items: [
        { label: 'Info Proyek', href: `${base}/settings`, icon: Settings, phase: 1 },
        { label: 'Anggota', href: `${base}/members`, icon: Users, phase: 1 },
      ],
    },
  ];
}

/** Strips entries a role must never see. */
export function visibleNavSections(projectId: string, role: ProjectRole): NavSection[] {
  const allowCosts = canViewCosts(role);

  return projectNavSections(projectId)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => (item.requiresCostAccess ? allowCosts : true)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Phases delivered so far. Modules beyond this render as "coming soon". */
export const CURRENT_PHASE = 9;
