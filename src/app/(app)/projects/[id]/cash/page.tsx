import { TriangleAlert, Wallet } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CashAccountButton, CashTransactionButton } from '@/features/cash/cash-actions';
import { CashflowChart } from '@/features/cash/cashflow-chart';
import { ClaimButton, DeleteTermButton, PayClaimButton, PaymentTermButton } from '@/features/cash/term-actions';
import { canEditContractTerms } from '@/lib/auth/roles';
import { CASH_CATEGORY_LABELS } from '@/lib/calc/cashflow';
import { EMPTY_VALUE, formatCurrency, formatDay, formatPercent } from '@/lib/format';
import { TERM_TYPE_LABELS } from '@/lib/validation/cash';
import { getCashflow, listCashAccounts, listClaims, listPaymentTerms } from '@/services/cash';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kas & Termin' };

const CLAIM_STATUS_LABELS = {
  DRAFT: 'Draf',
  SUBMITTED: 'Diajukan',
  APPROVED: 'Disetujui',
  PAID: 'Lunas',
} as const;

export default async function CashPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const project = await getProject(user.id, projectId);
  const canManage = canEditContractTerms(project.role);

  const [accounts, terms, claims, cashflow] = await Promise.all([
    listCashAccounts(user.id, projectId),
    listPaymentTerms(user.id, projectId),
    listClaims(user.id, projectId),
    getCashflow(user.id, projectId),
  ]);

  const accountOptions = accounts.map((account) => ({ id: account.id, name: account.name }));
  const nextSeq = terms.reduce((max, term) => Math.max(max, term.seq), 0) + 1;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kas & Termin"
        description="Kas dihitung dari transaksi yang tercatat, bukan diperkirakan dari progres. Termin owner dan pengeluaran bertemu di sini."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CashAccountButton projectId={projectId} canManage={canManage} variant="outline" />
            <PaymentTermButton projectId={projectId} nextSeq={nextSeq} canManage={canManage} />
            <CashTransactionButton
              projectId={projectId}
              accounts={accountOptions}
              canManage={canManage}
            />
          </div>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Belum ada akun kas"
          description="Semua penerimaan dan pengeluaran proyek dicatat pada akun kas. Buat satu terlebih dahulu, misalnya rekening proyek."
          action={
            <CashAccountButton
              projectId={projectId}
              canManage={canManage}
              label="Buat akun kas"
            />
          }
        />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Saldo saat ini" value={formatCurrency(currentBalance(accounts))} />
            <Figure label="Total masuk" value={formatCurrency(cashflow.totals.inflow)} />
            <Figure label="Total keluar" value={formatCurrency(cashflow.totals.outflow)} />
            <Figure
              label="Kebutuhan modal puncak"
              value={cashflow.peak ? formatCurrency(cashflow.peak.shortfall) : EMPTY_VALUE}
              caption={cashflow.peak ? `Terdalam pada ${cashflow.peak.label}` : 'Tidak pernah defisit'}
            />
          </dl>

          {cashflow.deficits.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" aria-hidden />
              <AlertTitle>
                Kas diperkirakan minus pada {cashflow.deficits.length} periode
              </AlertTitle>
              <AlertDescription>
                Paling dalam {formatCurrency(cashflow.peak?.shortfall ?? 0)} pada{' '}
                {cashflow.peak?.label}. Sediakan dana talangan sebesar itu, atau majukan penagihan
                termin sebelum periode tersebut.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Akun kas</h2>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead className="w-32">Jenis</TableHead>
                    <TableHead className="w-40 text-right">Saldo awal</TableHead>
                    <TableHead className="w-40 text-right">Saldo kini</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">{account.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {account.type === 'BANK' ? 'Rekening bank' : 'Kas tunai'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(account.openingBalance)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-medium tabular-nums ${
                          Number(account.currentBalance) < 0 ? 'text-destructive' : ''
                        }`}
                      >
                        {formatCurrency(account.currentBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {cashflow.hasPeriods ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Arus kas per periode</h2>
              <CashflowChart
                flow={cashflow.flow.map((point) => ({
                  label: point.label,
                  inflow: point.inflow,
                  outflow: point.outflow,
                  closing: point.closing,
                  isDeficit: point.isDeficit,
                }))}
              />
            </section>
          ) : (
            <Alert>
              <AlertTitle>Grafik arus kas menunggu periode</AlertTitle>
              <AlertDescription>
                Arus kas dikelompokkan per periode proyek.{' '}
                <ButtonLink
                  variant="link"
                  size="sm"
                  href={`/projects/${projectId}/schedule`}
                  className="h-auto p-0"
                >
                  Bangun kalender periode
                </ButtonLink>{' '}
                agar grafiknya dapat digambar.
              </AlertDescription>
            </Alert>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Termin owner</h2>
              <ClaimButton
                projectId={projectId}
                terms={terms.map((term) => ({ id: term.id, name: term.name, seq: term.seq }))}
                canManage={canManage}
              />
            </div>

            {terms.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Belum ada termin. Susun jadwal penagihan agar arus kas masuk dapat diproyeksikan.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead className="w-36">Jenis</TableHead>
                      <TableHead className="w-24 text-right">Porsi</TableHead>
                      <TableHead className="w-40 text-right">Nilai</TableHead>
                      <TableHead className="w-28">Pemicu</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      {canManage ? <TableHead className="w-12" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {terms.map((term) => (
                      <TableRow key={term.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {term.seq}
                        </TableCell>
                        <TableCell className="font-medium">{term.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {TERM_TYPE_LABELS[term.termType]}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {term.percent === null ? EMPTY_VALUE : formatPercent(term.percent, 1)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(term.valueAmount)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {term.triggerProgressPct === null ? (
                            EMPTY_VALUE
                          ) : (
                            <span className={term.isUnlocked ? 'text-primary' : undefined}>
                              {formatPercent(term.triggerProgressPct, 0)}
                              {term.isUnlocked ? ' · terbuka' : ''}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {term.status}
                          </Badge>
                        </TableCell>
                        {canManage ? (
                          <TableCell>
                            <DeleteTermButton
                              projectId={projectId}
                              termId={term.id}
                              name={term.name}
                              claimed={Number(term.claimedAmount) > 0}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Tagihan</h2>
            {claims.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Belum ada tagihan yang dibuat.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">No.</TableHead>
                      <TableHead className="w-28">Tanggal</TableHead>
                      <TableHead>Termin</TableHead>
                      <TableHead className="w-24 text-right">Sertifikasi</TableHead>
                      <TableHead className="w-36 text-right">Bruto</TableHead>
                      <TableHead className="w-36 text-right">Bersih</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      {canManage ? <TableHead className="w-32" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((claim) => (
                      <TableRow key={claim.id}>
                        <TableCell className="font-mono text-xs">{claim.claimNo}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDay(claim.claimDate)}
                        </TableCell>
                        <TableCell>{claim.termName}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatPercent(claim.certifiedProgressPct, 1)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(claim.grossAmount)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {formatCurrency(claim.netAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={claim.status === 'PAID' ? 'secondary' : 'outline'}
                            className="text-[10px]"
                          >
                            {CLAIM_STATUS_LABELS[claim.status]}
                          </Badge>
                        </TableCell>
                        {canManage ? (
                          <TableCell>
                            {claim.status === 'PAID' ? (
                              <span className="text-xs text-muted-foreground">
                                {claim.paidAt ? formatDay(claim.paidAt) : null}
                              </span>
                            ) : (
                              <PayClaimButton
                                projectId={projectId}
                                claimId={claim.id}
                                claimNo={claim.claimNo}
                                netAmount={claim.netAmount}
                                accounts={accountOptions}
                                canManage={canManage}
                              />
                            )}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          {cashflow.hasPeriods ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Rincian per periode</h2>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Periode</TableHead>
                      <TableHead className="w-36 text-right">Masuk</TableHead>
                      <TableHead className="w-36 text-right">Keluar</TableHead>
                      <TableHead className="w-36 text-right">Bersih</TableHead>
                      <TableHead className="w-40 text-right">Saldo akhir</TableHead>
                      <TableHead>Pengeluaran terbesar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashflow.flow.map((point) => (
                      <TableRow key={point.periodId}>
                        <TableCell>{point.label}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(point.inflow)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(point.outflow)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(point.net)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono font-medium tabular-nums ${
                            point.isDeficit ? 'text-destructive' : ''
                          }`}
                        >
                          {formatCurrency(point.closing)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {largestCategory(point.byCategory)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function currentBalance(accounts: { currentBalance: string }[]): number {
  return accounts.reduce((acc, account) => acc + Number(account.currentBalance), 0);
}

function largestCategory(byCategory: Record<string, string>): string {
  const entries = Object.entries(byCategory).filter(
    ([category]) => category in CASH_CATEGORY_LABELS,
  );
  if (entries.length === 0) return EMPTY_VALUE;

  const [category, amount] = entries.reduce((max, entry) =>
    Number(entry[1]) > Number(max[1]) ? entry : max,
  );

  return `${CASH_CATEGORY_LABELS[category as keyof typeof CASH_CATEGORY_LABELS]} · ${formatCurrency(amount)}`;
}

function Figure({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
