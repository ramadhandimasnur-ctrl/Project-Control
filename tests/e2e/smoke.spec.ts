import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke test: can a real user sign in and reach every module?
 *
 * Deliberately shallow. The service layer already has several hundred
 * integration tests proving the arithmetic; what none of them can prove is that
 * the pages render at all once assembled — a broken import or a client
 * component reaching for a server-only module fails here and nowhere else.
 *
 * Credentials come from the same environment variables the seed script uses, so
 * this runs against a seeded database and nothing is hard-coded.
 */

const EMAIL = process.env.SEED_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  'SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD belum diisi; jalankan npm run db:seed terlebih dahulu.',
);

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/kata sandi|password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /masuk|login/i }).click();
  await page.waitForURL(/\/projects/, { timeout: 30_000 });
}

/** Opens the first project and returns its id. */
async function openFirstProject(page: Page): Promise<string> {
  await page.goto('/projects');

  const firstProject = page.locator('a[href^="/projects/"]').filter({
    hasNotText: 'Proyek baru',
  });

  const href = await firstProject.first().getAttribute('href');
  expect(href, 'butuh minimal satu proyek; jalankan npm run db:seed').toBeTruthy();

  const id = href!.split('/')[2]!;
  await page.goto(`/projects/${id}`);
  return id;
}

test('masuk dan membuka daftar proyek', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Proyek', exact: true })).toBeVisible();
});

test('setiap modul proyek terbuka tanpa error', async ({ page }) => {
  await signIn(page);
  const id = await openFirstProject(page);

  /*
   * Asserted by path rather than by expected wording: headings get reworded,
   * and a test that fails on a copy edit trains people to ignore it. What must
   * never change is that the page answers and renders something.
   */
  const paths = [
    '',
    '/work-items',
    '/estimate',
    '/schedule',
    '/scurve',
    '/progress',
    '/material',
    '/warehouse',
    '/purchases',
    '/cash',
    '/capital',
    '/reports',
    '/reports/opname',
    '/settings',
    '/members',
  ];

  for (const path of paths) {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const response = await page.goto(`/projects/${id}${path}`);
    expect(response?.status(), `${path} membalas ${response?.status()}`).toBeLessThan(400);

    await expect(
      page.getByRole('heading').first(),
      `${path} tidak menampilkan judul`,
    ).toBeVisible();

    expect(errors, `${path} melempar error di peramban`).toEqual([]);
    page.removeAllListeners('pageerror');
  }
});

test('sidebar tidak menyisakan modul terkunci', async ({ page }) => {
  await signIn(page);
  const id = await openFirstProject(page);
  await page.goto(`/projects/${id}`);

  const nav = page.getByRole('navigation', { name: 'Navigasi proyek' });
  await expect(nav).toBeVisible();

  // A phase badge means the module is still gated as unbuilt.
  await expect(nav.getByText(/^F\d$/)).toHaveCount(0);
});

test('ekspor menghasilkan berkas Excel, bukan halaman error', async ({ page }) => {
  await signIn(page);
  const id = await openFirstProject(page);

  for (const report of ['progress', 'cashflow', 'finance']) {
    const response = await page.request.get(`/projects/${id}/exports/${report}`);

    expect(response.status(), `ekspor ${report}`).toBe(200);
    expect(response.headers()['content-type']).toContain('spreadsheet');

    // Every .xlsx is a zip, and every zip starts with these two bytes.
    const body = await response.body();
    expect(body.subarray(0, 2).toString('latin1'), `ekspor ${report} bukan xlsx`).toBe('PK');
  }
});

test('laporan tak dikenal ditolak, bukan dirender kosong', async ({ page }) => {
  await signIn(page);
  const id = await openFirstProject(page);

  const response = await page.request.get(`/projects/${id}/exports/tidak-ada`);
  expect(response.status()).toBe(404);
});
