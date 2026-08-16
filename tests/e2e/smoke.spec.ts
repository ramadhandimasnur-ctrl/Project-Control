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
  /*
   * Fifteen pages, each assembling its figures from a hosted database, take
   * longer together than the default per-test budget allows. Raised rather than
   * split so one login covers the walk; each navigation still has its own
   * ceiling below, so a genuinely stuck page fails by name instead of running
   * the whole test out of time.
   */
  test.setTimeout(300_000);

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
    // The old combined page, kept as a redirect; it must still land somewhere.
    '/estimate',
    '/estimate/rab',
    '/estimate/rap',
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

    const response = await page.goto(`/projects/${id}${path}`, { timeout: 45_000 });
    expect(response?.status(), `${path} membalas ${response?.status()}`).toBeLessThan(400);

    await expect(
      page.getByRole('heading').first(),
      `${path} tidak menampilkan judul`,
    ).toBeVisible();

    expect(errors, `${path} melempar error di peramban`).toEqual([]);
    page.removeAllListeners('pageerror');
  }
});

/*
 * The seeded account is an organisation administrator, so this page must open.
 * A member reaching it gets the refusal notice instead, which the service
 * enforces rather than the route.
 */
test('panel pengguna terbuka bagi administrator', async ({ page }) => {
  await signIn(page);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const response = await page.goto('/users', { timeout: 45_000 });
  expect(response?.status()).toBeLessThan(400);

  // Pinned to the page title. Plain `name: 'Pengguna'` also matches the
  // "Semua pengguna" section heading, and an ambiguous locator fails on a
  // wording change that broke nothing.
  await expect(page.getByRole('heading', { level: 1, name: 'Pengguna' })).toBeVisible();
  await expect(page.getByText('Menunggu persetujuan').first()).toBeVisible();
  expect(errors).toEqual([]);
});

/*
 * The one interactive path worth asserting here: the price dialog is the only
 * place RAB and RAP are entered, and it now opens prefilled from what is
 * already stored. A prefill that silently stopped working would show an empty
 * RAB beside a filled RAP — which reads as "no budget price" for a resource
 * that has one, and would be saved back as exactly that.
 */
test('dialog harga terisi dari harga yang berlaku', async ({ page }) => {
  await signIn(page);
  await page.goto('/master-data/resources');

  /*
   * Deliberately a resource that already has a price, not simply the first
   * row. The catalogue also holds items with no price at all, and opening one
   * of those proves nothing about prefilling — the field is empty because
   * there is nothing to fill it with.
   */
  const pricedRow = page.locator('tbody tr').filter({ hasText: /Rp\s?\d/ }).first();

  if ((await pricedRow.count()) === 0) {
    test.skip(true, 'tidak ada sumber daya berharga; jalankan npm run db:seed');
    return;
  }

  const href = await pricedRow
    .locator('a[href^="/master-data/resources/"]')
    .first()
    .getAttribute('href');
  expect(href).toBeTruthy();

  await page.goto(href!);
  await page.getByRole('button', { name: /tambah harga|harga/i }).first().click();

  const rap = page.getByLabel(/Harga RAP per/i);
  await expect(rap).toBeVisible();
  await expect(rap).not.toHaveValue('');

  await expect(page.getByLabel(/Markup RAB atas RAP/i)).toBeVisible();
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
