# Project Control

Aplikasi pengendalian proyek konstruksi: estimasi (RAB/RAP), jadwal dan kurva-S,
progres lapangan, material dan gudang, kas, termin, serta laporan.

Prinsip produk: **input sedikit, sistem menghitung banyak.** Setiap angka yang
tampil berasal dari database melalui rumus yang bisa ditelusuri dan diuji —
tidak ada angka contoh yang di-hardcode.

---

## Status

| Fase | Isi | Status |
|---|---|---|
| 1 | Skema DB penuh, auth, CRUD proyek, anggota & otorisasi, layout, seed demo | **Selesai** |
| 2 | Master data: satuan, kategori, resource, harga, supplier, impor Excel | Belum |
| 3 | Work breakdown, volume take-off, AHSP, RAB/RAP, template | Belum |
| 4 | Kebutuhan material, gudang, pembelian + POST transaksional | Belum |
| 5 | Periode, jadwal, Gantt, baseline, kurva-S rencana | Belum |
| 6 | Input progres, approval, ceklis mutu, kurva-S realisasi | Belum |
| 7 | Cashflow, termin, subkon, kebutuhan modal | Belum |
| 8 | Dashboard lengkap | Belum |
| 9 | Laporan, snapshot, print + PDF, ekspor Excel | Belum |
| 10 | E2E, performa, aksesibilitas | Belum |

Sidebar proyek menampilkan modul yang belum dibangun dengan lencana fasenya.

---

## Menjalankan

### 1. Prasyarat

Node.js 20.11+ dan sebuah database PostgreSQL 16.

### 2. Konfigurasi

```bash
cp .env.example .env.local
```

Isi `.env.local`:

**Supabase (disarankan)** — buat project di [supabase.com](https://supabase.com),
lalu dari *Project Settings*:

- *API* → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`
- *Database* → `DATABASE_URL` dari **Transaction Pooler** (port 6543) dan
  `DIRECT_URL` dari **Direct connection** (port 5432)

`DIRECT_URL` wajib terpisah: pooler transaksi tidak dapat menjalankan DDL.

**Postgres lokal** — alternatif, memerlukan Docker:

```bash
docker compose up -d
```

Nilai default `DATABASE_URL`/`DIRECT_URL` di `.env.example` sudah menunjuk ke sana
(port host 5433). Auth tetap memakai Supabase.

### 3. Siapkan database

```bash
npm install
npm run db:setup
```

`db:setup` menjalankan migrasi lalu menerapkan trigger integritas, row-level
security, dan view.

### 4. Data demo (opsional)

```bash
npm run db:seed
```

Membuat satu proyek gudang kecil beserta 3 akun demo, dan mencetak tabel
verifikasi yang bisa dicek dengan kalkulator. Gunakan `-- --reset` untuk membuat
ulang.

### 5. Jalankan

```bash
npm run dev
```

---

## Perintah

| Perintah | Kegunaan |
|---|---|
| `npm run dev` | Server pengembangan |
| `npm run build` | Build produksi |
| `npm run typecheck` | TypeScript strict, tanpa emit |
| `npm run lint` | ESLint |
| `npm test` | Unit test (Vitest) |
| `npm run test:coverage` | Unit test + ambang cakupan `lib/calc` (90%) |
| `npm run e2e` | End-to-end (Playwright) — jalankan `npm run e2e:install` sekali dahulu |
| `npm run db:generate` | Buat file migrasi dari perubahan skema |
| `npm run db:migrate` | Terapkan migrasi |
| `npm run db:views` | Terapkan trigger, RLS, dan view |
| `npm run db:setup` | `db:migrate` + `db:views` |
| `npm run db:seed` | Isi data demo |
| `npm run db:reset -- --force` | **Hapus seluruh schema public.** Hanya untuk pengembangan |
| `npm run db:studio` | Drizzle Studio |

---

## Arsitektur

```
src/
  app/(auth)/          login, register
  app/(app)/projects/  modul proyek
  db/schema/           definisi Drizzle per domain (39 tabel)
  db/sql/              trigger integritas & row-level security
  db/views.sql         view pelaporan
  lib/calc/            SELURUH RUMUS. Fungsi murni, tanpa akses DB.
  lib/auth/roles.ts    model peran, murni & teruji
  services/            akses DB + otorisasi + transaksi
  features/<modul>/    komponen khusus modul
  components/ui/       primitif shadcn/ui
```

Aturan yang ditegakkan lintas fase:

1. Rumus hanya di `lib/calc/`. Menemukan `a * b` di dalam JSX berarti ada yang
   salah tempat.
2. Uang tidak pernah menyentuh float: `numeric` di Postgres, `decimal.js` di
   TypeScript, pembulatan hanya di lapisan tampilan.
3. Pembagian dengan nol mengembalikan `null`, ditampilkan sebagai `—`.
4. Nilai turunan dihitung dari transaksi, bukan disimpan — kecuali
   `report_snapshots` dan `baseline_distributions` yang memang sengaja beku.
5. Operasi lintas tabel selalu dalam satu transaksi database.
6. Transaksi keuangan dan inventory bersifat append-only; koreksi lewat
   pembalik atau VOID. Ditegakkan oleh trigger, bukan hanya oleh konvensi.
7. Otorisasi di server: setiap fungsi service diawali `assertProjectAccess`.
   RLS adalah lapis kedua di belakangnya.

Keputusan teknis yang diambil di luar dokumen arsitektur dicatat di
[`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md).

---

## Catatan verifikasi

Mesin pengembangan tempat Fase 1 dikerjakan tidak memiliki Docker, WSL, maupun
Postgres, sehingga bagian berikut **belum pernah dijalankan terhadap database
sungguhan**:

- migrasi `0000_init.sql`
- trigger integritas (`src/db/sql/010_triggers.sql`)
- row-level security (`src/db/sql/020_rls.sql`)
- seed demo
- alur login dan pembuatan proyek dari ujung ke ujung

Begitu `.env.local` terisi, jalankan:

```bash
npm run db:setup && npm run db:seed && npm test
```

`src/db/__tests__/integrity.test.ts` melewatkan dirinya sendiri selama database
belum tersedia, dan mulai menguji trigger serta RLS begitu koneksi ada.

---

## Arsip

`legacy/mvp-vite/` berisi prototipe berbasis `localStorage` yang mendahului
aplikasi ini. Disimpan sebagai rujukan logika domain; tidak ikut di-build,
di-lint, maupun di-typecheck.
