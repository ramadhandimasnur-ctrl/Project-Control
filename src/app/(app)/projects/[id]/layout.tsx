import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { ProjectMobileNav } from '@/features/navigation/mobile-nav';
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
    /*
      From `lg` up this is a frame the size of the viewport, and nothing but the
      two columns inside it scrolls.

      The project menu is taller than most screens. With the page as the only
      scroll container, reaching "Anggota" meant scrolling the whole frame — the
      content column went up with it. And once a page inside also had a scroll
      container of its own, the two competed for the same wheel: scrolling the
      content to its end simply stopped, though the page plainly continued
      below. Both scrollbars were doing exactly what they were told; the trouble
      was that there were two.

      Below `lg` the page scrolls as usual. A phone shows one column at a time
      and has no room to give away to a frame.
    */
    <div
      data-print="frame"
      className="flex min-h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)] lg:min-h-0 lg:overflow-hidden"
    >
      <aside
        data-print="hide"
        className="hidden w-60 shrink-0 flex-col border-r bg-muted/20 lg:flex"
      >
        <div className="shrink-0 border-b p-4">
          <p className="font-mono text-xs text-muted-foreground">{project.code}</p>
          <p className="mt-0.5 line-clamp-2 text-sm font-semibold">{project.name}</p>
          <Badge variant="secondary" className="mt-2 text-[10px]">
            {PROJECT_ROLE_LABELS[project.role]}
          </Badge>
        </div>
        {/*
          The menu scrolls itself. The project's name and role stay pinned above
          it, which is the part you look at to be sure which project you are in.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ProjectSidebar projectId={project.id} role={project.role} />
        </div>
      </aside>
      {/*
        The stash holds site photographs in memory for the whole project area,
        so one attached during an inspection is still there when the report is
        opened. It must sit above the pages, not inside a dialog that unmounts.
      */}
      <main data-print="frame" className="min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto">
        {/*
          Below `lg` the sidebar beside this is not collapsed, it is absent.
          This bar carries the project's identity and the button that opens the
          same menu in a drawer.
        */}
        <ProjectMobileNav
          projectId={project.id}
          code={project.code}
          name={project.name}
          role={project.role}
        />
        {children}
      </main>
    </div>
  );
}
