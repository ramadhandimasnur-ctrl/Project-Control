import { Hammer, MousePointerClick } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { AhspPanel } from '@/features/work-items/ahsp-panel';
import {
  WorkItemActionsBar,
  WorkItemCreateButton,
} from '@/features/work-items/work-item-actions-bar';
import { canEditProjectData } from '@/lib/auth/roles';
import { EMPTY_VALUE, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getWorkItemEstimate } from '@/services/ahsp';
import { listApplicableTemplates } from '@/services/ahsp-templates';
import { toDecimal } from '@/lib/calc/decimal';
import { canViewOrgCosts } from '@/services/org-access';
import { getProject } from '@/services/projects';
import { listResources } from '@/services/resources';
import { requireSessionUser } from '@/services/session';
import { listUnits } from '@/services/units';
import { getWorkItemDeletionImpact, listWorkItems } from '@/services/work-breakdown';

export const metadata: Metadata = { title: 'Pekerjaan & AHSP' };

export default async function WorkItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { id: projectId } = await params;
  const { item: requestedItem } = await searchParams;

  const user = await requireSessionUser();
  const project = await getProject(user.id, projectId);
  const canEdit = canEditProjectData(project.role);

  const [items, units, showCosts, templates] = await Promise.all([
    listWorkItems(user.id, projectId),
    listUnits(user.id),
    canViewOrgCosts(user.id),
    // Only templates whose resources all still exist and are active can be
    // applied without leaving a half-built analysis behind.
    canEdit ? listApplicableTemplates(user.id) : Promise.resolve([]),
  ]);

  // Selection lives in the URL so a particular analysis can be linked to.
  const selected = items.find((i) => i.id === requestedItem) ?? items[0] ?? null;

  const [estimate, impact, catalogue] = selected
    ? await Promise.all([
        getWorkItemEstimate(user.id, projectId, selected.id),
        canEdit
          ? getWorkItemDeletionImpact(user.id, projectId, selected.id)
          : Promise.resolve({ ahspLines: 0, takeoffs: 0, progressEntries: 0, materialTransactions: 0 }),
        canEdit ? listResources(user.id, { limit: 500 }) : Promise.resolve({ items: [] }),
      ])
    : [null, null, { items: [] }];

  const unitOptions = units.map((u) => ({ id: u.id, code: u.code, name: u.name }));

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      {/* Left: the work breakdown */}
      <aside className="flex w-80 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div>
            <p className="text-sm font-semibold">Pekerjaan</p>
            <p className="text-xs text-muted-foreground">{items.length} item</p>
          </div>
          {canEdit ? (
            <WorkItemCreateButton projectId={projectId} units={unitOptions} />
          ) : null}
        </div>

        <nav aria-label="Daftar pekerjaan" className="flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Belum ada pekerjaan.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((workItem) => {
                const active = selected?.id === workItem.id;
                return (
                  <li key={workItem.id}>
                    <Link
                      href={`/projects/${projectId}/work-items?item=${workItem.id}`}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'block rounded-md px-2 py-2 text-sm transition-colors',
                        active
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/60 hover:text-accent-foreground',
                      )}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {workItem.code}
                        </span>
                        {workItem.lineCount === 0 ? (
                          <Badge variant="outline" className="ml-auto text-[10px]">
                            belum ada analisa
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block font-medium">{workItem.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatQuantity(workItem.volume)} {workItem.unitCode}
                        {workItem.groupName ? ` · ${workItem.groupName}` : ''}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>

      {/* Right: the analysis of the selected item */}
      <main className="min-w-0 flex-1 overflow-x-auto p-6">
        {selected === null || estimate === null ? (
          <EmptyState
            icon={items.length === 0 ? Hammer : MousePointerClick}
            title={items.length === 0 ? 'Belum ada pekerjaan' : 'Pilih sebuah pekerjaan'}
            description={
              items.length === 0
                ? 'Tambahkan pekerjaan terlebih dahulu, lalu susun analisa harga satuannya di panel ini.'
                : 'Pilih pekerjaan di panel kiri untuk melihat dan menyusun analisanya.'
            }
          />
        ) : (
          <div className="space-y-4">
            {canEdit && impact ? (
              <div className="flex justify-end">
                <WorkItemActionsBar
                  projectId={projectId}
                  workItemId={selected.id}
                  workItemCode={selected.code}
                  workItemName={selected.name}
                  unitCode={selected.unitCode}
                  volumeLocked={selected.hasTakeoffs}
                  impact={impact}
                  units={unitOptions}
                  templates={templates}
                  defaultValues={{
                    code: selected.code,
                    name: selected.name,
                    spec: selected.spec ?? '',
                    groupId: selected.groupId ?? '',
                    unitId: selected.unitId,
                    volume: selected.volume,
                    volumeRap: selected.volumeRap ?? '',
                    contractUnitPrice: selected.contractUnitPrice ?? '',
                    unitPriceRab: selected.unitPriceRab ?? '',
                    unitPriceRap: selected.unitPriceRap ?? '',
                    priceMarkupPercent:
                      selected.priceMarkupPercent === null
                        ? ''
                        : toDecimal(selected.priceMarkupPercent).times(100).toString(),
                    progressMethod: selected.progressMethod,
                    includeInProgressWeight: selected.includeInProgressWeight,
                    sortOrder: selected.sortOrder,
                  }}
                />
              </div>
            ) : null}

            <AhspPanel
              projectId={projectId}
              workItemId={selected.id}
              workItemCode={selected.code}
              workItemName={selected.name}
              unitCode={selected.unitCode}
              estimate={estimate}
              canEdit={canEdit}
              showCosts={showCosts}
              resources={catalogue.items.map((r) => ({
                id: r.id,
                code: r.code,
                name: r.name,
                spec: r.spec,
                unitCode: r.unitCode,
              }))}
            />

            {selected.hasTakeoffs ? (
              <p className="text-xs text-muted-foreground">
                Volume {formatQuantity(selected.volume)} {selected.unitCode} diturunkan dari baris
                take-off.
              </p>
            ) : null}

            {selected.contractUnitPrice === null ? (
              <p className="text-xs text-muted-foreground">
                Harga satuan kontrak belum diisi, sehingga nilai kontrak dihitung dari RAB ditambah
                markup proyek. Saat ini: {EMPTY_VALUE}
              </p>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
