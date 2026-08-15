import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { ProjectSidebar } from '@/features/projects/project-sidebar';
import { PROJECT_ROLE_LABELS } from '@/lib/auth/roles';
import { isAppError } from '@/lib/errors';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionUser();

  const project = await getProject(user.id, id).catch((error: unknown) => {
    // Both "does not exist" and "not your organisation" surface as 404 —
    // confirming that an id exists is itself a disclosure.
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
      notFound();
    }
    throw error;
  });

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <aside className="hidden w-60 shrink-0 border-r bg-muted/20 lg:block">
        <div className="border-b p-4">
          <p className="font-mono text-xs text-muted-foreground">{project.code}</p>
          <p className="mt-0.5 line-clamp-2 text-sm font-semibold">{project.name}</p>
          <Badge variant="secondary" className="mt-2 text-[10px]">
            {PROJECT_ROLE_LABELS[project.role]}
          </Badge>
        </div>
        <ProjectSidebar projectId={project.id} role={project.role} />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
