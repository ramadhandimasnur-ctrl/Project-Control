import { NextResponse } from 'next/server';

import { canViewCosts } from '@/lib/auth/roles';
import { CASH_CATEGORY_LABELS } from '@/lib/calc/cashflow';
import { todayIso } from '@/lib/date';
import { isAppError, toUserMessage } from '@/lib/errors';
import {
  cashflowSheet,
  exportFileName,
  financeSheets,
  progressSheets,
  type SheetSpec,
} from '@/lib/export/sheets';
import { buildWorkbook } from '@/lib/export/workbook';
import { formatDay } from '@/lib/format';
import { getProjectEstimate } from '@/services/ahsp';
import { getCashflow, getFinancialSummary } from '@/services/cash';
import { getProgressBoard, getProgressComparison } from '@/services/progress';
import { getProject } from '@/services/projects';
import { getScheduleOverview } from '@/services/schedule';
import { requireSessionUser } from '@/services/session';

/**
 * Spreadsheet exports.
 *
 * A route handler rather than a server action: the answer is a file, and a plain
 * GET that the browser downloads needs no JavaScript on the page to work. It
 * also keeps a large workbook out of the action response, which is sized for
 * form submissions rather than documents.
 *
 * Authorisation is the same as the pages: project access first, and the two
 * money reports refuse a role that is never shown costs. Handing them over as a
 * download would be the easiest way around a rule the screens enforce.
 */

const REPORTS = ['cashflow', 'finance', 'progress'] as const;
type Report = (typeof REPORTS)[number];

function isReport(value: string): value is Report {
  return (REPORTS as readonly string[]).includes(value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; report: string }> },
) {
  const { id: projectId, report } = await params;

  if (!isReport(report)) {
    return NextResponse.json({ error: 'Jenis laporan tidak dikenal.' }, { status: 404 });
  }

  try {
    const user = await requireSessionUser();
    const project = await getProject(user.id, projectId);
    const showCosts = canViewCosts(project.role);

    if (report !== 'progress' && !showCosts) {
      return NextResponse.json(
        { error: 'Peran Anda tidak diberi akses ke angka biaya.' },
        { status: 403 },
      );
    }

    const preamble = [
      `${project.code} — ${project.name}`,
      project.location ? `Lokasi: ${project.location}` : '',
      `Periode pelaksanaan: ${formatDay(project.startDate)} – ${formatDay(project.endDate)}`,
      `Diekspor: ${formatDay(todayIso())} oleh ${user.fullName}`,
    ].filter((line) => line !== '');

    const sheets = await sheetsFor(report, user.id, projectId, preamble);
    const buffer = await buildWorkbook(sheets);
    const fileName = exportFileName(project.code, report, todayIso());

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const { message } = toUserMessage(error);
    const status = isAppError(error) && error.code === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function sheetsFor(
  report: Report,
  userId: string,
  projectId: string,
  preamble: string[],
): Promise<SheetSpec[]> {
  if (report === 'cashflow') {
    const cashflow = await getCashflow(userId, projectId);
    return [cashflowSheet({ preamble, flow: cashflow.flow })];
  }

  if (report === 'finance') {
    const [estimate, summary] = await Promise.all([
      getProjectEstimate(userId, projectId),
      getFinancialSummary(userId, projectId),
    ]);

    return financeSheets({
      preamble,
      items: estimate.items.map((item) => ({
        code: item.code,
        name: item.name,
        unitCode: item.unitCode,
        volume: item.volume,
        totalRab: item.totalRab,
        totalRap: item.totalRap,
        contractValue: item.contractValue,
        margin: item.margin,
        weight: item.weight,
      })),
      byCategory: summary.byCategory.map((row) => ({
        category:
          CASH_CATEGORY_LABELS[row.category as keyof typeof CASH_CATEGORY_LABELS] ?? row.category,
        amount: row.amount,
      })),
    });
  }

  const [schedule, comparison, board] = await Promise.all([
    getScheduleOverview(userId, projectId),
    getProgressComparison(userId, projectId),
    getProgressBoard(userId, projectId),
  ]);

  const lastReported = comparison.points.filter((point) => point.spi !== null).at(-1)?.seq ?? null;
  const actualBy = new Map(comparison.points.map((point) => [point.periodId, point]));

  return progressSheets({
    preamble,
    curve: schedule.curve.map((point) => {
      const paired = actualBy.get(point.periodId);
      // Beyond the last report the cells stay blank: nothing has been reported
      // because the date has not arrived, which is not the same as zero.
      const reported = lastReported !== null && point.seq <= lastReported;

      return {
        label: point.label,
        plannedPct: point.plannedPct,
        plannedCumulative: point.cumulativePct,
        actualCumulative: reported ? (paired?.actualCumulative.toString() ?? null) : null,
        deviation: reported ? (paired?.deviation.toString() ?? null) : null,
      };
    }),
    items: board.rows.map((row) => ({
      code: row.code,
      name: row.name,
      unitCode: row.unitCode,
      weight: row.weight,
      completedBefore: row.completedBefore,
      pctThisPeriod: row.pctThisPeriod,
      status: row.status ?? '',
    })),
  });
}
