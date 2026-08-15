import {
  Banknote,
  CalendarRange,
  ClipboardCheck,
  FileBarChart,
  LayoutDashboard,
  Package,
  Settings,
  Sigma,
  Users,
  Wallet,
  type LucideIcon,
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
      items: [{ label: 'Dashboard', href: base, icon: LayoutDashboard, phase: 8 }],
    },
    {
      title: 'Estimasi',
      items: [
        { label: 'Pekerjaan & AHSP', href: `${base}/work-items`, icon: Sigma, phase: 3 },
        {
          label: 'RAB & RAP',
          href: `${base}/estimate`,
          icon: FileBarChart,
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
        { label: 'Material & Gudang', href: `${base}/material`, icon: Package, phase: 4 },
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
      ],
    },
    {
      title: 'Laporan',
      items: [{ label: 'Laporan', href: `${base}/reports`, icon: FileBarChart, phase: 9 }],
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
export const CURRENT_PHASE = 1;
