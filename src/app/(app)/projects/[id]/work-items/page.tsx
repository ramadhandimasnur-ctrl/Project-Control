import { Hammer, MousePointerClick, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { AhspPanel } from '@/features/work-items/ahsp-panel';
import { WorkItemsShell } from '@/features/work-items/work-items-shell';
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

  const list = (
    <>
      <div className="flex items-center justify-between gap-2 border-b p-3">
          <div>
            <p className="text-sm font-semibold">Pekerjaan</p>
            <p className="text-xs text-muted-foreground">{items.length} item</p>
          </div>
          <div className="flex items-center gap-1">
            {/*
              The whole AHSP book, for the tender file. Placed beside the list
              rather than inside a single item's panel because that is the usual
              request. It opens on the RAB version; the print page itself offers
              the internal ones, and says what they are.
            */}
            <ButtonLink
              href={`/projects/${projectId}/work-items/print?versi=rab`}
              variant="ghost"
              size="icon-sm"
              aria-label="Cetak AHSP seluruh pekerjaan"
              title="Cetak AHSP seluruh pekerjaan — versi RAB, dapat diserahkan"
            >
              <Printer className="size-4" aria-hidden />
            </ButtonLink>
            {/*
              Hidden on a phone, where the floating button below does this job
              from somewhere a thumb can actually reach.
            */}
            {canEdit ? (
              <span className="hidden lg:inline-flex">
                <WorkItemCreateButton projectId={projectId} units={unitOptions} />
              </span>
            ) : null}
          </div>
        </div>

        <nav
          aria-label="Daftar pekerjaan"
          className="flex-1 overflow-y-auto overscroll-contain p-3 pb-24 lg:p-2 lg:pb-2"
        >
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Belum ada pekerjaan.
            </p>
          ) : (
            /*
              Cards on a phone, compact rows from `lg`. Same markup, different
              density: a second list written for the small screen is a second
              list that eventually disagrees with the first about what a work
              item shows.
            */
            <ul className="space-y-2 lg:space-y-0.5">
              {items.map((workItem) => {
                const active = selected?.id === workItem.id;
                return (
                  <li key={workItem.id}>
                    <Link
                      href={`/projects/${projectId}/work-items?item=${workItem.id}`}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'block min-h-16 rounded-lg border p-3 transition-colors',
                        'lg:min-h-0 lg:rounded-md lg:border-0 lg:px-2 lg:py-2',
                        active
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'hover:bg-accent/60 hover:text-accent-foreground',
                      )}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {workItem.code}
                        </span>
                        {workItem.groupName ? (
                          <span className="truncate text-xs text-muted-foreground lg:hidden">
                            · {workItem.groupName}
                          </span>
                        ) : null}
                      </span>

                      <span className="mt-0.5 block font-medium">{workItem.name}</span>

                      {/*
                        Volume, unit and the state of the analysis: the three
                        things worth knowing before deciding to open an item.
                      */}
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono tabular-nums">
                          {formatQuantity(workItem.volume)} {workItem.unitCode}
                        </span>
                        <span className="hidden lg:inline">
                          {workItem.groupName ? `· ${workItem.groupName}` : ''}
                        </span>
                        <Badge
                          variant={workItem.lineCount === 0 ? 'outline' : 'secondary'}
                          className="text-[10px]"
                        >
                          {workItem.lineCount === 0
                            ? 'belum ada analisa'
                            : `${workItem.lineCount} baris analisa`}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Within reach, and it does not scroll away with the list. */}
        {canEdit ? (
          <WorkItemCreateButton projectId={projectId} units={unitOptions} variant="fab" />
        ) : null}
    </>
  );

  const detail =
    selected === null || estimate === null ? (
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
                    unitRapId: selected.unitRapId ?? '',
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
        );

  return (
    <WorkItemsShell
      list={list}
      detail={detail}
      /*
       * Open only when the URL names an item. The page still defaults to the
       * first item so the desktop panel is never empty, but a phone arriving
       * at the list should see the list.
       */
      detailOpen={requestedItem !== undefined && selected !== null}
      detailTitle={selected ? `${selected.code} — ${selected.name}` : 'Analisa'}
      closeHref={`/projects/${projectId}/work-items`}
    />
  );
}
