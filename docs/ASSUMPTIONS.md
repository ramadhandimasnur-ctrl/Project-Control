# Asumsi & Keputusan Teknis

Catatan keputusan yang diambil saat membangun aplikasi, di luar hal-hal yang sudah
ditetapkan eksplisit di dokumen arsitektur. Setiap entri menyebutkan alasannya,
supaya keputusan bisa ditinjau ulang, bukan sekadar diikuti.

---

## Fase 1

### A1. Prototipe lama diarsipkan, tidak dihapus

Direktori kerja sudah berisi MVP berbasis Vite + React + `localStorage`
(`src/App.jsx`, ±1.000 baris) yang tidak berada di bawah kontrol versi.
Seluruh isinya dipindahkan apa adanya ke `legacy/mvp-vite/`.

**Alasan:** logika domainnya (struktur analisa, rekap kebutuhan) adalah rujukan
yang berguna, dan menghapus pekerjaan yang tidak ter-track git tidak dapat
dibatalkan. Direktori itu tidak ikut di-lint, di-typecheck, maupun di-build.

### A2. Target database: Supabase cloud

Docker, WSL, dan Postgres lokal tidak terpasang di mesin pengembangan.
`docker-compose.yml` tetap disediakan sebagai alternatif yang setara.

**Konsekuensi:** `DATABASE_URL` memakai Transaction Pooler (port 6543) dan
`DIRECT_URL` memakai koneksi langsung (port 5432). Pooler tidak dapat menjalankan
DDL, sehingga migrasi selalu lewat `DIRECT_URL`. `prepare: false` wajib karena
pooler tidak mendukung prepared statement.

### A3. Kolom tambahan pada `projects`

Dokumen arsitektur menyebut dua pengaturan proyek di bagian 4.5 dan 7 tanpa
mencantumkannya di definisi tabel:

- `require_checklist_before_approve boolean default true`
- `allow_negative_stock boolean default false`

Keduanya ditambahkan sebagai kolom `projects` karena keduanya adalah konfigurasi
per proyek, dan Fase 6 (persetujuan progres) serta Fase 4 (gudang) akan
membacanya.

### A4. Kolom tambahan untuk model kebutuhan modal

Bagian 5.9 memerlukan `lead_time_days` untuk material dan `supplier_credit_days`
untuk menggeser tanggal kas keluar. Karena Fase 1 harus menetapkan skema penuh
sekali jalan ("fase berikutnya mengisi, bukan merombak"), keduanya ditambahkan
sekarang:

- `resources.lead_time_days int default 0`
- `suppliers.credit_days int default 0` — kredit adalah atribut pemasok, bukan
  atribut material, sehingga diletakkan di `suppliers`.

### A5. `suppliers` ditempatkan sebagai master data organisasi

Dokumen mencantumkan `suppliers` di bagian 4.6 (Material), tetapi tabelnya
ber-scope `org_id`, bukan `project_id`. Definisinya diletakkan bersama master
data lain di `src/db/schema/resources.ts`.

### A6a. Peran `app_runtime` — tanpa ini RLS tidak berlaku sama sekali

Ditemukan saat verifikasi terhadap database sungguhan: peran `postgres` milik
Supabase memiliki atribut **`BYPASSRLS`**. Peran dengan atribut itu mengabaikan
seluruh policy, termasuk yang ber-`FORCE ROW LEVEL SECURITY`. Selama aplikasi
menyambung sebagai `postgres`, RLS terkonfigurasi rapi tetapi tidak pernah
dievaluasi.

`src/db/sql/005_app_role.sql` membuat peran `app_runtime`: `NOLOGIN`, tanpa
atribut istimewa, hanya memegang hak data. `withUser()` menjalankan
`SET LOCAL ROLE app_runtime` di setiap transaksi request, sehingga policy
mengikat selama transaksi itu dan kembali normal saat commit. Tidak perlu
connection string kedua maupun password tambahan — aplikasi tetap menyambung
sebagai `postgres`, hanya berhenti *bertindak* sebagai `postgres` begitu
menyentuh data proyek.

Konsekuensi yang menyusul, semuanya sudah ditangani dan diuji:

- `projects` dan `project_members` memerlukan `WITH CHECK` terpisah dari
  `USING`. Saat proyek dibuat, barisnya ditulis sebelum keanggotaan ada,
  sehingga `WITH CHECK` berbasis keanggotaan akan menolak insert pertama dan
  proyek tidak akan pernah bisa dibuat. Pembacaan tetap berbasis keanggotaan;
  hanya penulisan yang dilonggarkan sebatas organisasi milik pengguna.
- `createProject` membangkitkan UUID-nya sendiri, bukan memakai
  `INSERT … RETURNING`. `RETURNING` dievaluasi terhadap klausa `USING`, yang
  belum dapat dipenuhi pembuatnya.
- Subquery di dalam policy juga tunduk pada policy tabel yang dibacanya.
  Pencarian organisasi pemilik proyek karena itu memakai fungsi
  `SECURITY DEFINER` `pc_project_org_id()`.

### A6. Desain Row Level Security

Identitas masuk ke database lewat GUC transaksional:

```sql
SELECT set_config('app.current_user_id', '<uuid>', true)
```

Tanpa GUC, semua policy bernilai false — **gagal tertutup**, bukan terbuka.
Skrip migrasi dan seed memakai `app.bypass_rls = 'on'` untuk transaksinya
sendiri.

**Empat tabel tulang punggung** (`organizations`, `users`, `projects`,
`project_members`) memakai `ENABLE ROW LEVEL SECURITY` tanpa `FORCE`.
Alasannya teknis dan penting: fungsi pembantu policy harus membaca tabel-tabel
itu untuk menjawab "siapa pengguna ini dan apa yang boleh dilihatnya". Bila
keempatnya ber-`FORCE`, policy pada `projects` akan memanggil fungsi yang
menyeleksi `projects`, yang memicu policy yang sama — Postgres menggagalkannya
dengan *infinite recursion detected in policy*.

Seluruh tabel yang benar-benar memuat data proyek memakai `FORCE`, sehingga
service yang lupa memanggil `assertProjectAccess` tetap tidak dapat membocorkan
datanya. Tulang punggung dijaga oleh lapisan service, dan policy-nya tetap
mengikat peran non-owner (mis. `authenticated` milik PostgREST).

**Belum terverifikasi terhadap database sungguhan** — lihat catatan di README.
`src/db/__tests__/integrity.test.ts` akan membuktikannya begitu koneksi tersedia.

### A7. Hubungan antara `db/views.sql` dan `lib/calc/`

Aturan 3 melarang rumus hidup di luar `lib/calc/`, sementara bagian 4.10
mewajibkan 13 view yang secara alami mengandung aritmetika.

**Keputusan:** `lib/calc/` adalah otoritas. View adalah cermin performa supaya
dashboard dan laporan mengagregasi ribuan baris di database, bukan di Node.
Setiap view lahir bersama unit test yang menegaskan hasilnya sama dengan fungsi
murni padanannya pada data seed. Bila keduanya berbeda, view yang salah.

**Jadwal:** setiap view ditulis pada fase yang memiliki datanya, karena rumus
yang ditulis sebelum input-nya ada tidak bisa diverifikasi. Fase 1 tidak
menghasilkan view; jadwal lengkapnya ada di header `src/db/views.sql`.

### A8. `estimate.ts` dan `weight.ts` ditarik maju ke Fase 1

Keduanya milik Fase 3, tetapi seed demo harus mencetak angka yang dapat
diverifikasi manual, dan aturan 3 melarang menghitungnya ulang di dalam skrip
seed. Menulis kedua modul sekarang — lengkap dengan unit test-nya — lebih benar
daripada menduplikasi rumus. Fase 3 tinggal menambahkan UI dan view-nya.

### A9. Persentase disimpan sebagai pecahan 0..1

Konsisten dengan bagian 2. Formulir tetap menerima dan menampilkan 0..100;
konversi terjadi di `src/lib/validation/numeric.ts` (masuk) dan
`src/lib/format.ts` (keluar). Nilai ambang deviasi adalah satu-satunya
persentase yang boleh negatif.

### A10. Tarif pajak dan retensi default nol

Aturan 13 melarang tarif ter-hardcode. Karena itu nilai awal formulir proyek
untuk retensi, PPN, dan PPh adalah **0**, bukan angka yang lazim dipakai.
Satu-satunya default numerik yang dipertahankan adalah ambang deviasi
(-0,5% dan -5%), yang memang ditetapkan dokumen arsitektur.

### A11. Peran efektif administrator organisasi

`users.global_role = 'ADMIN'` memperoleh peran efektif `ADMIN` pada seluruh
proyek **dalam organisasinya sendiri**, tanpa perlu baris `project_members`.
`assertProjectAccess` mengembalikan `viaGlobalAdmin: true` untuk kasus ini agar
audit tetap dapat membedakannya dari keanggotaan sungguhan.

### A12. Proyek di organisasi lain dilaporkan sebagai NOT_FOUND

Bukan FORBIDDEN. Membenarkan bahwa sebuah id proyek itu ada sudah merupakan
kebocoran informasi.

### A13. Proyek wajib menyisakan satu Manajer Proyek

`services/members.ts` menolak penghapusan atau penurunan peran yang membuat
proyek kehilangan seluruh anggota ber-peran `PROJECT_MANAGER`/`ADMIN`.
Mengunci diri sendiri keluar dari proyek yang sedang berjalan bukan kesalahan
yang bisa dipulihkan pengguna non-administrator.

### A14. Pendaftaran membuat organisasi sekaligus

Akun pertama sebuah organisasi otomatis menjadi `global_role = 'ADMIN'`.
Pengguna tanpa organisasi tidak dapat memiliki apa pun. Bila konfirmasi email
aktif di Supabase, baris `organizations` dan `users` tetap dibuat saat sign-up
memakai id dari `auth.users`, sehingga login pertama langsung berfungsi.

### A15. shadcn/ui kini menggunakan Base UI, bukan Radix

Registry shadcn versi terkini menghasilkan komponen di atas `@base-ui/react`.
Konsekuensi pada kode aplikasi:

- `asChild` diganti prop `render`:
  `<Button render={<Link href="…" />}>Label</Button>`
- `Select.onValueChange` bertipe `(value: string | null, details) => void`,
  sehingga `null` harus ditangani eksplisit.

### A16. Pembuatan `schedule_periods` ditunda ke Fase 5

Wizard proyek pada dokumen bagian 6.2 mencakup langkah "Periode", tetapi
periodisasi adalah milik Fase 5 beserta validasi `Σ planned_pct = 1` dan
baseline. Fase 1 hanya menyimpan `start_date`, `end_date`, dan `period_type`
yang menjadi masukan generator tersebut.

### A17. Modul yang belum dibangun ditampilkan, bukan disembunyikan

Sidebar proyek menampilkan seluruh peta modul sejak awal; yang belum jadi
diberi lencana fase (`F3`, `F5`, …) dan tidak dapat diklik. Navigasi yang
tumbuh diam-diam tidak memberi gambaran arah produk, dan yang mengarah ke 404
lebih buruk lagi.

### A18. Browser Playwright belum diunduh

`playwright.config.ts` siap, tetapi binari browser belum diunduh karena
mengunduh berkas memerlukan persetujuan eksplisit pengguna. Jalankan
`npm run e2e:install` sebelum `npm run e2e`. Rangkaian E2E lengkap adalah
lingkup Fase 10.
