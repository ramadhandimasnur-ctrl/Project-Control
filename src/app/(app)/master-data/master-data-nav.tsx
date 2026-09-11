'use client';

import {
  Boxes,
  HardHat,
  Library,
  Ruler,
  Tags,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  boxes: Boxes,
  tags: Tags,
  ruler: Ruler,
  truck: Truck,
  library: Library,
  warehouse: Warehouse,
  hardhat: HardHat,
};

export type MasterDataNavItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
};

export function MasterDataNav({ items }: { items: MasterDataNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigasi master data" className="p-3">
      <ul className="space-y-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon] ?? Boxes;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/60 hover:text-accent-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
