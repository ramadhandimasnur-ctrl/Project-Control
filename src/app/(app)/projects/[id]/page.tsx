import { ArrowRight, Info } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { canViewCosts } from '@/lib/auth/roles';
import { formatCurrency, formatDay, formatPercent } from '@/lib/format';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionUser();
  const project = await getProject(user.id, id);
  const showCosts = canViewCosts(project.role);

  const facts: { label: string; value: string }[] = [
    { label: 'Nomor kontrak', value: project.contractNo ?? '—' },
    { label: 'Pemilik', value: project.ownerName ?? '—' },
    { label: 'Kontraktor', value: project.contractorName ?? '—' },
    { label: 'Lokasi', value: project.location ?? '—' },
    {
      label: 'Periode pelaksanaan',
      value: `${formatDay(project.startDate)} – ${formatDay(project.endDate)}`,
    },
    {
      label: 'Tipe periode',
      value: { DAY: 'Harian', WEEK: 'Mingguan', MONTH: 'Bulanan' }[project.periodType],
    },
    ...(showCosts
      ? [
          { label: 'Nilai kontrak', value: formatCurrency(project.contractValue) },
          { label: 'Retensi', value: formatPercent(project.retentionPercent) },
          { label: 'PPN', value: formatPercent(project.vatPercent) },
          { label: 'PPh', value: formatPercent(project.whtPercent) },
        ]
      : []),
    {
      label: 'Dasar bobot progres',
      value: { CONTRACT: 'Nilai kontrak', RAB: 'RAB', RAP: 'RAP' }[project.progressWeightBasis],
    },
    {
      label: 'Pengakuan biaya',
      value: {
        PURCHASE_BASED: 'Saat pembelian',
        CONSUMPTION_BASED: 'Saat pemakaian',
      }[project.costRecognition],
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={project.name}
        description="Ringkasan konfigurasi proyek."
        actions={
          <Button
            variant="outline"
            render={<Link href={`/projects/${project.id}/settings`} />}
          >
            Ubah pengaturan
          </Button>
        }
      />

      {/* No fabricated numbers: the KPI cards and the four charts arrive with
          the data that feeds them, not before. */}
      <Alert>
        <Info className="size-4" aria-hidden />
        <AlertTitle>Dashboard lengkap hadir pada Fase 8</AlertTitle>
        <AlertDescription>
          Kartu KPI dan empat grafik (Kurva-S, cashflow, RAP vs aktual, status material) menunggu
          data estimasi, jadwal, dan progres. Sampai data itu ada, halaman ini menampilkan
          konfigurasi proyek apa adanya — bukan angka contoh.
          <span className="mt-2 block">
            <Link
              href={`/projects/${project.id}/members`}
              className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
            >
              Kelola anggota proyek
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </span>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Informasi proyek</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {fact.label}
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
