import { FolderPlus, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PROJECT_ROLE_LABELS } from '@/lib/auth/roles';
import { formatCurrency, formatDay } from '@/lib/format';
import { listProjects } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Daftar Proyek' };

const STATUS_LABELS = {
  DRAFT: 'Draf',
  ACTIVE: 'Aktif',
  ON_HOLD: 'Ditunda',
  CLOSED: 'Selesai',
} as const;

const STATUS_VARIANTS = {
  DRAFT: 'outline',
  ACTIVE: 'default',
  ON_HOLD: 'secondary',
  CLOSED: 'secondary',
} as const;

export default async function ProjectsPage() {
  const user = await requireSessionUser();
  const projects = await listProjects(user);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Proyek"
        description="Setiap proyek memiliki pekerjaan, sumber daya, jadwal, dan kas sendiri."
        actions={
          <Button render={<Link href="/projects/new" />}>
            <Plus className="size-4" aria-hidden />
            Proyek baru
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="Belum ada proyek"
          description="Buat proyek pertama Anda untuk mulai menyusun estimasi, jadwal, dan pengendalian biaya."
          action={
            <Button render={<Link href="/projects/new" />}>
              <Plus className="size-4" aria-hidden />
              Buat proyek
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama proyek</TableHead>
                <TableHead>Lokasi</TableHead>
                <TableHead className="text-right">Nilai kontrak</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>Peran Anda</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                /*
                 * The whole row is a click target, but only one real link.
                 * The anchor's ::after is stretched across the positioned row,
                 * so keyboard and screen-reader users get a single focusable
                 * destination instead of one per cell.
                 */
                <TableRow
                  key={project.id}
                  className="relative cursor-pointer transition-colors hover:bg-accent/50 focus-within:bg-accent/50"
                >
                  <TableCell className="font-mono text-xs">{project.code}</TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${project.id}`}
                      className="after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {project.location ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(project.contractValue)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDay(project.startDate, 'd MMM yy')} – {formatDay(project.endDate, 'd MMM yy')}
                  </TableCell>
                  <TableCell>{PROJECT_ROLE_LABELS[project.role]}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[project.status]}>
                      {STATUS_LABELS[project.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
