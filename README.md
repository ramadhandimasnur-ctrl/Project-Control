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
| 2 | Master data: satuan, kategori, resource, harga, supplier, impor Excel | **Selesai** |
| 3 | Work breakdown, volume take-off, AHSP, RAB/RAP, template | **Selesai** |
| 4 | Kebutuhan material, gudang, pembelian + POST transaksional | **Selesai** |
| 5 | Periode, jadwal, Gantt, baseline, kurva-S rencana | **Selesai** |
| 6 | Input progres, approval, ceklis mutu, kurva-S realisasi | **Selesai** |
| 7 | Cashflow, termin owner, kebutuhan modal, dashboard eksekutif, ekspor Excel | **Selesai** |
| 8 | Dashboard lengkap | **Selesai** (dikirim bersama Fase 7) |
| 9 | Laporan, snapshot beku, cetak, ekspor Excel | **Selesai** |
| 10 | Uji asap E2E, penyiapan produksi | **Selesai** |

Seluruh modul pada sidebar sudah aktif; tidak ada lagi lencana fase.

### Ditangguhkan

Domain **subkontraktor** — `subcontracts`, `subcontract_items`,
`subcontract_certificates`, `subcontract_advances` — ada di skema tetapi belum
punya service maupun antarmuka. Sejalan dengan itu, nilai `SUBCON_PAYMENT` dan
`PAYROLL` pada `cash_source_type` tidak pernah ditulis siapa pun.

Ini keputusan sadar, bukan kelalaian: alur inti divalidasi lebih dulu lewat
pemakaian nyata sebelum domain baru ditambahkan. Biaya subkontraktor yang sudah
dibayar tetap masuk hitungan lewat pencatatan kas manual dengan kategori
`SUBCON`, sehingga arus kas dan varians biaya tetap utuh — yang belum ada adalah
kontrak, sertifikat progres subkon, dan pengembalian uang mukanya.

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
| `npm run build:check` | Build verifikasi ke direktori terpisah; aman saat `dev` berjalan |
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
| `npm run db:import:utba -- "<file.xlsx>" --email=<admin>` | Baca sheet UTBA tanpa menyimpan |
| `npm run db:import:utba -- "<file.xlsx>" --email=<admin> --apply` | Impor sumber daya ke katalog |
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

Setiap fase diverifikasi terhadap Supabase sungguhan, bukan hanya typecheck:
migrasi, trigger integritas, row-level security, POST transaksional, alur
persetujuan progres, dan perhitungan keuangan semuanya diuji terhadap basis
data hidup.

Uji integrasi melewatkan dirinya sendiri bila database tidak terjangkau,
sehingga `npm test` tetap lulus di mesin tanpa Postgres — dan kembali menguji
trigger serta RLS begitu koneksi ada. Perhatikan bilangan yang dilewati: suite
yang "hijau" tanpa database hanya membuktikan kalkulasi murninya.

Untuk menyiapkan lingkungan dari nol:

```bash
npm run db:setup && npm run db:seed && npm test
```

---

## Menyiapkan produksi

### Sebelum deploy

```bash
npm run typecheck && npm run lint && npm test && npm run build:check
```

`build:check` membangun ke direktori terpisah lewat `NEXT_DIST_DIR`, sehingga
aman dijalankan sementara `npm run dev` masih hidup. `npm run build` biasa
menulis ke `.next` yang sama dengan dev server dan akan membuat peramban
kehilangan chunk-nya.

### Variabel lingkungan di server

Semua yang ada di `.env.example` wajib terisi. Tiga hal yang mudah terlewat:

- `DATABASE_URL` memakai **transaction pooler** (port 6543) untuk runtime;
  `DIRECT_URL` memakai **session pooler** (port 5432) dan hanya dipakai migrasi.
  Pooler transaksi tidak dapat menjalankan DDL dengan andal.
- `SUPABASE_SERVICE_ROLE_KEY` tidak boleh berprefiks `NEXT_PUBLIC_`. Kunci ini
  melewati row-level security; membocorkannya ke peramban membuka seluruh basis
  data.
- Sandi Postgres yang mengandung `/` atau `@` tetap aman — `src/db/connection.ts`
  mengurai connection string sendiri justru karena `new URL()` gagal menanganinya.

### Migrasi saat rilis

```bash
npm run db:migrate   # DDL, lewat DIRECT_URL
npm run db:views     # trigger, RLS, dan view
```

Keduanya idempoten. `db:views` perlu dijalankan ulang setiap rilis yang
mengubah view atau kebijakan RLS, karena keduanya ditulis ulang secara utuh,
bukan lewat migrasi bertahap.

### Zona waktu

Tanggal disimpan sebagai `date` tanpa zona waktu dan ditampilkan apa adanya.
Satu tempat yang membaca jam server adalah `todayIso()` di `src/lib/date.ts`,
dan ia membaca kalender dalam UTC — pada server UTC, tanggal "hari ini" baru
berganti pukul 07:00 WIB. Ini disengaja dan tercatat di sana; memperbaikinya
membutuhkan zona waktu per proyek.

### Uji asap

```bash
npm run e2e:install   # sekali, mengunduh Chromium
npm run e2e
```

Uji asap masuk memakai `SEED_ADMIN_EMAIL` dan `SEED_ADMIN_PASSWORD`, lalu
membuka setiap modul proyek dan memeriksa ekspor Excel benar-benar menghasilkan
berkas. Ia melewatkan dirinya sendiri bila kedua variabel itu kosong.

### Penyimpanan berkas

Tidak ada. Foto dokumentasi lapangan hidup di peramban sebagai object URL dan
dicetak langsung ke laporan; tidak ada bucket yang perlu disiapkan, dan foto
hilang bila halaman dimuat ulang. Ini keputusan sadar, bukan kelalaian.

---

## Arsip

`legacy/mvp-vite/` berisi prototipe berbasis `localStorage` yang mendahului
aplikasi ini. Disimpan sebagai rujukan logika domain; tidak ikut di-build,
di-lint, maupun di-typecheck.
