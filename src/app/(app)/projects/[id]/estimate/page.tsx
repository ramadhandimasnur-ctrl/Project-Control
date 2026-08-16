import { redirect } from 'next/navigation';

/**
 * The old combined RAB/RAP page.
 *
 * Kept as a redirect rather than deleted: links to it exist in bookmarks and in
 * anything already sent out, and a 404 on a page someone used yesterday is a
 * worse answer than landing them on the half they were most likely after.
 */
export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  redirect(`/projects/${projectId}/estimate/rab`);
}
