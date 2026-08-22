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

/**
 * Signs in, and says why if it cannot.
 *
 * `SEED_ADMIN_PASSWORD` is a fixture that a human can legitimately invalidate
 * from inside the running application — the account menu now offers "Ganti kata
 * sandi", and an administrator may deactivate an account from the user panel.
 * When that happens the whole suite fails, and it used to fail on a bare
 * `waitForURL` timeout that says nothing about the cause. Reading the refusal
 * off the page turns half an hour of confusion into one line.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/kata sandi|password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /masuk|login/i }).click();

  // Filtered to alerts that actually say something: the toast region is also
  // `role="alert"` and is present and empty on every page.
  const refusal = page.getByRole('alert').filter({ hasText: /\S/ }).first();
  const landed = page.waitForURL(/\/projects/, { timeout: 30_000 });

  await Promise.race([
    landed,
    refusal.waitFor({ timeout: 30_000 }).then(async () => {
      throw new Error(
        `Gagal masuk sebagai ${EMAIL}: "${(await refusal.textContent())?.trim()}". ` +
          'Kredensial di .env.local kemungkinan sudah tidak sesuai dengan keadaan akun — ' +
          'kata sandi dapat diganti dari dalam aplikasi, dan akun dapat dinonaktifkan lewat panel Pengguna.',
      );
    }),
  ]);

  await landed;
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
    '/cco',
    /*
     * The print sheets are ordinary pages that happen to be styled for paper,
     * and they assemble more data than any other screen — both analyses of
     * every work item, and the whole scope against Baseline 0. If one of them
     * throws, it does so here or on somebody's tender deadline.
     */
    '/work-items/print',
    '/cco/print',
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
 * The project menu on a phone.
 *
 * The sidebar is `hidden lg:block`, which on a narrow screen does not mean
 * collapsed — it means absent. Every page inside a project was unreachable
 * from the device the site team actually carries, and no desktop-width test
 * could have noticed.
 */
test('menu proyek dapat dibuka dari layar ponsel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const id = await openFirstProject(page);

  // The sidebar really is gone at this width; the drawer is the only way in.
  await expect(page.getByRole('navigation', { name: 'Navigasi proyek' })).toBeHidden();

  await page.getByRole('button', { name: 'Buka menu proyek' }).click();

  const drawer = page.getByRole('navigation', { name: 'Navigasi proyek' });
  await expect(drawer).toBeVisible();

  // Follow a link that only exists in the project menu, and land on it.
  await drawer.getByRole('link', { name: 'RAB' }).click();
  await page.waitForURL(new RegExp(`/projects/${id}/estimate/rab`), { timeout: 30_000 });

  // Navigating closes the drawer; leaving it open reads as a tap that did
  // nothing, because the page behind it has already changed.
  await expect(drawer).toBeHidden();
});

/*
 * The parts of "feels right on a phone" that are actually measurable.
 *
 * Easing and blur are matters of taste and are left to the eye. A target
 * smaller than a fingertip, a panel that hides the whole page, a backdrop that
 * ignores taps, and a menu that scrolls the page behind it are not — each is a
 * number or a state, and each is the kind of regression a redesign reintroduces
 * without anyone noticing.
 */
test('laci proyek nyaman disentuh di layar ponsel', async ({ page }) => {
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await signIn(page);
  await openFirstProject(page);

  const trigger = page.getByRole('button', { name: 'Buka menu proyek' });
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox?.height ?? 0, 'tombol burger lebih kecil dari 44px').toBeGreaterThanOrEqual(44);
  expect(triggerBox?.width ?? 0).toBeGreaterThanOrEqual(44);

  await trigger.click();
  const drawer = page.getByRole('navigation', { name: 'Navigasi proyek' });
  await expect(drawer).toBeVisible();

  /*
   * Wide enough to read, narrow enough that the page behind stays in view. A
   * drawer at 100% is not a drawer, it is a second screen.
   */
  const panel = page.getByRole('dialog');
  const panelBox = await panel.boundingBox();
  const ratio = (panelBox?.width ?? 0) / viewport.width;
  expect(ratio, `lebar laci ${Math.round(ratio * 100)}% dari layar`).toBeLessThanOrEqual(0.85);
  expect(ratio).toBeGreaterThan(0.6);

  // Every menu row is at least a fingertip tall.
  const links = await drawer.getByRole('link').all();
  expect(links.length).toBeGreaterThan(3);
  for (const link of links) {
    const box = await link.boundingBox();
    const label = (await link.textContent())?.trim();
    expect(box?.height ?? 0, `baris "${label}" lebih pendek dari 44px`).toBeGreaterThanOrEqual(44);
  }

  /*
   * Scrolling the menu must not scroll the page underneath it. Without
   * `overscroll-contain` the gesture chains through once the menu bottoms out,
   * and the reader closes the drawer somewhere they never navigated to.
   */
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await drawer.hover();
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY), 'halaman ikut bergeser').toBe(scrollBefore);

  // Tapping the dark area closes it — the gesture everyone tries first.
  await page.mouse.click(viewport.width - 12, viewport.height / 2);
  await expect(drawer).toBeHidden();
});

/*
 * Pekerjaan & AHSP on a phone.
 *
 * The page is a two-column master/detail, which on a 390px screen gave the
 * list 40% and the analysis the rest — both unreadable. What is asserted here
 * is the shape of the fix: one column, the analysis behind a sheet rather than
 * beside the list, and no table wide enough to push its amounts off-screen.
 */
test('halaman AHSP terbaca satu kolom di layar ponsel', async ({ page }) => {
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await signIn(page);
  const id = await openFirstProject(page);
  await page.goto(`/projects/${id}/work-items`);

  // The list fills the width instead of sharing it with a squeezed panel.
  const list = page.getByRole('navigation', { name: 'Daftar pekerjaan' });
  const listBox = await list.boundingBox();
  expect((listBox?.width ?? 0) / viewport.width).toBeGreaterThan(0.9);

  const cards = list.getByRole('link');
  if ((await cards.count()) === 0) {
    test.skip(true, 'proyek ini belum punya pekerjaan; jalankan npm run db:seed');
    return;
  }

  // Arriving at the list shows the list, not an analysis nobody asked for.
  await expect(page.getByRole('dialog')).toBeHidden();

  const first = cards.first();
  expect((await first.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await first.click();

  // The analysis arrives as a sheet, and it is full width.
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  expect((sheetBox?.width ?? 0) / viewport.width).toBeGreaterThan(0.95);

  /*
   * Nothing inside the sheet may be wider than the sheet. A table that
   * overflows here is exactly the complaint this replaced — the amounts are
   * the rightmost columns, so they are what disappears.
   */
  const overflow = await sheet.evaluate((node) => {
    const root = node as HTMLElement;
    return Array.from(root.querySelectorAll('*')).some(
      (el) => (el as HTMLElement).scrollWidth > root.clientWidth + 1,
    );
  });
  expect(overflow, 'ada elemen yang lebih lebar dari lembarnya').toBe(false);

  await sheet.getByRole('button', { name: 'Tutup analisa' }).click();
  await expect(sheet).toBeHidden();
});

/*
 * The account menu, opened rather than merely rendered.
 *
 * Its contents only mount on click, so a component that throws while opening
 * ships perfectly happily: the page loads, the walk above passes, and the
 * failure waits for whoever clicks their own name. That is exactly how the
 * missing `Menu.Group` context reached a running app.
 */
test('menu akun terbuka tanpa melempar error', async ({ page }) => {
  await signIn(page);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.getByRole('button', { name: /^Menu akun / }).click();

  await expect(page.getByRole('menuitem', { name: /keluar/i })).toBeVisible();
  expect(errors, 'membuka menu akun melempar error di peramban').toEqual([]);
});

/*
 * Signing out, by clicking it rather than by looking at it.
 *
 * The test above asserts the item is visible, which it always was — the
 * handler behind it was bound to `onSelect`, a prop Base UI's menu item does
 * not have, so the button rendered perfectly and did nothing. A visible
 * control is not a working one, and only pressing it tells them apart.
 */
test('keluar benar-benar mengakhiri sesi', async ({ page }) => {
  await signIn(page);

  await page.getByRole('button', { name: /^Menu akun / }).click();
  await page.getByRole('menuitem', { name: /keluar/i }).click();

  await page.waitForURL(/\/login/, { timeout: 30_000 });

  // Back to a protected page: still signed out, so it must bounce again.
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login/);
});

/*
 * Changing your own password, up to the point where it would actually change.
 *
 * The refusal is what gets asserted rather than a successful change: a test
 * that really rotated the seed account's password would break every later run
 * of this suite, including its own sign-in. What matters here is that the
 * dialog opens, submits, and that a wrong current password is refused — which
 * is the guard the whole form exists for.
 */
test('ganti kata sandi menolak kata sandi lama yang salah', async ({ page }) => {
  await signIn(page);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.getByRole('button', { name: /^Menu akun / }).click();
  await page.getByRole('menuitem', { name: /ganti kata sandi/i }).click();

  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByLabel('Kata sandi saat ini').fill('jelas-bukan-kata-sandinya');
  await page.getByLabel('Kata sandi baru', { exact: true }).fill('KataSandiBaru123');
  await page.getByLabel('Ulangi kata sandi baru').fill('KataSandiBaru123');
  await page.getByRole('button', { name: /simpan kata sandi/i }).click();

  await expect(page.getByText('Kata sandi saat ini salah.')).toBeVisible();
  expect(errors, 'form ganti kata sandi melempar error di peramban').toEqual([]);
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

  /*
   * A markup the row does not already carry. Typing back the stored figure
   * changes nothing, so every assertion below would pass on a page where the
   * binding had been ripped out entirely — the first version of this test did
   * exactly that and only the save button noticed.
   */
  const typed = (await markup.inputValue()).trim() === '17.5' ? '12.5' : '17.5';
  await markup.fill(typed);

  const expected = Number(rapBefore) * (1 + Number(typed) / 100);
  expect(Number(await rab.inputValue())).toBeCloseTo(expected, 2);
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

/*
 * One scrollbar per column on a wide screen, and none on the page.
 *
 * The project menu is taller than most screens, so the page itself scrolled;
 * the analysis panel scrolled too. Two scroll containers then competed for the
 * same wheel, and because the panel holds its overscroll, reaching the panel's
 * end simply stopped everything — the page plainly continued below and would
 * not move. That is what "cannot scroll down" meant.
 *
 * Measured rather than eyeballed: the page must have nothing to scroll, and
 * the panel must reach its own end with the last of the analysis on screen.
 */
test('layar desktop: halaman tidak menggulir, tiap kolom menggulir sendiri', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  const id = await openFirstProject(page);
  await page.goto(`/projects/${id}/work-items`);
  await expect(page.getByRole('navigation', { name: 'Daftar pekerjaan' })).toBeVisible();

  const pageScrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 1,
  );
  expect(pageScrolls, 'halaman masih punya penggulir sendiri').toBe(false);

  // The project menu carries its own scrollbar instead of dragging the page.
  const menuReachesEnd = await page.evaluate(() => {
    const nav = document.querySelector('[aria-label="Navigasi proyek"]');
    const box = nav?.closest('div');
    if (!box) return null;
    const last = nav!.querySelectorAll('a');
    const target = last[last.length - 1];
    if (!target) return null;
    box.scrollTop = box.scrollHeight;
    const r = target.getBoundingClientRect();
    return r.bottom <= window.innerHeight + 1 && r.top >= 0;
  });
  expect(menuReachesEnd, 'menu terakhir tidak terjangkau tanpa menggulir halaman').not.toBe(false);

  /*
   * The panel reaches its own end. Asserted through the last child rather than
   * through scrollTop alone: a container can report a scroll position it never
   * actually shows, and what was reported here was content that stayed out of
   * reach, not a number that failed to change.
   */
  const panel = page.locator('main').last();
  const reachedEnd = await panel.evaluate((node) => {
    const el = node as HTMLElement;
    if (el.scrollHeight <= el.clientHeight + 1) return 'nothing to scroll';
    el.scrollTop = el.scrollHeight;
    const last = el.lastElementChild?.lastElementChild;
    if (!last) return 'no content';
    const r = last.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return r.bottom <= box.bottom + 1 ? 'ok' : `tertinggal ${Math.round(r.bottom - box.bottom)}px`;
  });
  expect(reachedEnd, 'ujung analisa tidak terjangkau').toMatch(/^(ok|nothing to scroll)$/);

  // And the page still has not moved after all that scrolling.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

/*
 * The action buttons sit beside the figures they act on.
 *
 * The column reserved 26rem for the busiest row a draft can produce, and every
 * quieter row had its two buttons pushed to the far right of it — a hand's
 * width of blank table between "Mutu" and "Catat". The reserved width is gone
 * and the group is aligned left, so the distance is now the cell padding.
 */
test('tombol aksi tabel progres tidak terpisah jauh dari kolomnya', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const id = await openFirstProject(page);
  await page.goto(`/projects/${id}/progress`);

  const gap = await page.evaluate(() => {
    const table = document.querySelector('table');
    const row = table?.querySelector('tbody tr');
    const cells = row ? [...row.querySelectorAll('td')] : [];
    const actions = cells[cells.length - 1]?.firstElementChild;
    const previous = cells[cells.length - 2];
    if (!actions || !previous) return null;
    return Math.round(actions.getBoundingClientRect().left - previous.getBoundingClientRect().right);
  });

  if (gap === null) {
    test.skip(true, 'proyek ini belum punya baris progres');
    return;
  }
  // Cell padding, not a reserved column: anything near 100px is the old bug.
  expect(gap, `jarak tombol aksi ${gap}px`).toBeLessThan(48);
});

/*
 * Selecting a work item must not put a modal over the desktop layout.
 *
 * The sheet is styled `lg:hidden`, which hides its backdrop and its panel and
 * nothing else. An open dialog also marks the page `aria-hidden`, locks body
 * scroll and lays a fixed blocking element across the viewport — none of which
 * a breakpoint suppresses. So on a wide screen, choosing any item other than
 * the default one left the analysis unscrollable, because every wheel event
 * landed on an invisible sheet.
 *
 * The first item hid the fault: it is the default selection and carries no
 * `?item=`, so the dialog stayed shut and that one item behaved.
 */
test('memilih pekerjaan kedua tidak memasang modal di layar desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  const id = await openFirstProject(page);
  await page.goto(`/projects/${id}/work-items`);

  const items = page.getByRole('navigation', { name: 'Daftar pekerjaan' }).getByRole('link');
  if ((await items.count()) < 2) {
    test.skip(true, 'butuh minimal dua pekerjaan');
    return;
  }

  // The second item — the one that puts `?item=` in the URL and used to open
  // the sheet behind the desktop layout.
  await items.nth(1).click();
  await page.waitForURL(/\?item=/, { timeout: 30_000 });

  const state = await page.evaluate(() => {
    const panel = document.querySelector('main:last-of-type') as HTMLElement | null;
    const box = panel?.getBoundingClientRect();
    const centre =
      panel && box
        ? (document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)[0] ?? null)
        : null;
    return {
      // Base UI's blocking overlay carries both of these; our own backdrop
      // is a plain div and never does.
      blockingOverlay: document.querySelector('[data-base-ui-inert][role]') !== null,
      pageHidden: document.querySelector('body > div[aria-hidden="true"]') !== null,
      bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
      // Whatever a wheel would land on must belong to the analysis, not to a
      // sheet lying invisibly on top of it.
      centreInsidePanel: panel !== null && centre !== null && panel.contains(centre),
    };
  });

  expect(state.blockingOverlay, 'lembar ponsel terbuka di layar desktop').toBe(false);
  expect(state.pageHidden, 'halaman ditandai aria-hidden').toBe(false);
  expect(state.bodyLocked, 'guliran halaman dikunci').toBe(false);
  expect(state.centreInsidePanel, 'ada yang menutupi panel analisa').toBe(true);
});
