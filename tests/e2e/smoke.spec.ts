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

/**
 * The first catalogue row that already carries an execution price.
 *
 * Deliberately not simply the first row. The catalogue also holds items with
 * no price at all, and those prove nothing about prefilling or binding — a
 * field is empty there because there is nothing to fill it with. Returns null
 * when the catalogue has no priced row, which the callers turn into a skip
 * rather than a false pass.
 */
async function findPricedRow(page: Page) {
  const rows = page.locator('tbody tr');
  const total = await rows.count();

  for (let index = 0; index < total; index += 1) {
    const row = rows.nth(index);
    const rap = row.getByLabel(/^Harga RAP /);
    if ((await rap.count()) === 0) continue;
    if ((await rap.inputValue()).trim() !== '') return row;
  }

  return null;
}

/*
 * Prices are now typed straight into the catalogue row, and the three fields
 * move together: a markup fills the budget price while the execution price
 * stays put. The binding runs in the browser, so nothing in the service tests
 * can catch it going wrong — a broken import or a stale handler would leave
 * three inputs that simply ignore each other.
 */
test('markup yang diketik mengisi harga RAB di baris katalog', async ({ page }) => {
  await signIn(page);
  await page.goto('/master-data/resources');

  const row = await findPricedRow(page);
  if (row === null) {
    test.skip(true, 'tidak ada sumber daya berharga; jalankan npm run db:seed');
    return;
  }

  const rap = row.getByLabel(/^Harga RAP /);
  const rab = row.getByLabel(/^Harga RAB /);
  const markup = row.getByLabel(/^Markup /);

  const rapBefore = await rap.inputValue();
  await markup.fill('10');

  expect(Number(await rab.inputValue())).toBeCloseTo(Number(rapBefore) * 1.1, 2);
  // The execution cost is authoritative and must survive the edit untouched.
  await expect(rap).toHaveValue(rapBefore);

  /*
   * Saving is explicit, so the button appears only once something changed.
   * Nothing is clicked here: the write path is covered by the service tests,
   * and a smoke test should not rewrite the catalogue it is reading.
   */
  await expect(row.getByRole('button', { name: /^Simpan harga /i })).toBeVisible();
});

/*
 * The same three fields on the work-item form, for lump-sum lines that carry a
 * price and no analysis worth writing. Worth its own assertion because the
 * binding is wired differently here — react-hook-form owns the inputs — so it
 * can break on this form while the catalogue keeps working.
 */
test('form pekerjaan menghitung harga RAB dari markup yang diketik', async ({ page }) => {
  await signIn(page);
  const id = await openFirstProject(page);
  await page.goto(`/projects/${id}/work-items`);

  await page.getByRole('button', { name: 'Tambah pekerjaan' }).first().click();

  const rap = page.getByLabel('Harga RAP', { exact: true });
  await expect(rap).toBeVisible();

  await rap.fill('100000');
  await page.getByLabel('Markup (%)', { exact: true }).fill('20');

  await expect(page.getByLabel('Harga RAB', { exact: true })).toHaveValue('120000');
});

/*
 * The dialog on the resource detail page is still the way a price is recorded
 * against a past date, and it opens prefilled from what is already stored. A
 * prefill that silently stopped working would show an empty RAB beside a
 * filled RAP — which reads as "no budget price" for a resource that has one,
 * and would be saved back as exactly that.
 */
test('dialog harga terisi dari harga yang berlaku', async ({ page }) => {
  await signIn(page);
  await page.goto('/master-data/resources');

  const row = await findPricedRow(page);
  if (row === null) {
    test.skip(true, 'tidak ada sumber daya berharga; jalankan npm run db:seed');
    return;
  }

  const href = await row.locator('a[href^="/master-data/resources/"]').first().getAttribute('href');
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
