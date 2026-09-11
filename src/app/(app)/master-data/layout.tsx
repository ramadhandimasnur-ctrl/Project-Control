import { MasterDataNav, type MasterDataNavItem } from './master-data-nav';

const ITEMS: MasterDataNavItem[] = [
  { href: '/master-data/resources', label: 'Sumber Daya', icon: 'boxes' },
  { href: '/master-data/categories', label: 'Kategori', icon: 'tags' },
  { href: '/master-data/units', label: 'Satuan', icon: 'ruler' },
  { href: '/master-data/suppliers', label: 'Pemasok', icon: 'truck' },
  { href: '/master-data/foremen', label: 'Mandor', icon: 'hardhat' },
  { href: '/master-data/ahsp-library', label: 'Pustaka AHSP', icon: 'library' },
  { href: '/master-data/warehouses', label: 'Gudang Pusat', icon: 'warehouse' },
];

export default function MasterDataLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <aside className="hidden w-52 shrink-0 border-r bg-muted/20 lg:block">
        <div className="border-b p-4">
          <p className="text-sm font-semibold">Master Data</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Dipakai bersama seluruh proyek</p>
        </div>
        <MasterDataNav items={ITEMS} />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
