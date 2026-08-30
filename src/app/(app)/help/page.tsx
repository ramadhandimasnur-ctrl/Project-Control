import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Petunjuk' };

/**
 * The guide, inside the application rather than beside it.
 *
 * Written as answers to questions people actually ask, not as a tour of the
 * menu — a tour tells you where the buttons are, which is the one thing the
 * menu already does. What it cannot tell you is which of two similar-looking
 * numbers you should be reading, and that is where every question starts.
 *
 * Static on purpose. A help page that reads live data becomes a second place
 * where the figures are computed, and a second place is a second answer.
 */

type Entry = { question: string; answer: React.ReactNode };

const SECTIONS: { title: string; intro: string; entries: Entry[] }[] = [
  {
    title: 'Tiga angka yang mudah tertukar',
    intro:
      'Hampir semua kebingungan di aplikasi ini berpangkal pada satu hal: RAB, RAP, dan realisasi menjawab pertanyaan yang berbeda.',
    entries: [
      {
        question: 'RAB itu apa?',
        answer: (
          <>
            Yang dijual. Dasar penagihan ke pemilik, dan dasar bobot progres. Kalau ada yang
            bertanya &ldquo;proyek ini nilainya berapa&rdquo;, jawabannya dari sini.
          </>
        ),
      },
      {
        question: 'RAP itu apa?',
        answer: (
          <>
            Yang direncanakan keluar. Anggaran biaya pelaksanaan, memakai koefisien dan harga yang
            benar-benar akan dipakai di lapangan. Selisih RAB dikurangi RAP adalah margin yang
            direncanakan.
          </>
        ),
      },
      {
        question: 'Realisasi itu apa?',
        answer: (
          <>
            Yang benar-benar keluar. Material yang keluar dari gudang, sertifikat mandor yang
            disetujui, dan biaya yang dicatat langsung. Ada di{' '}
            <strong>Kendali Biaya</strong>.
          </>
        ),
      },
      {
        question: 'Kenapa CPI bukan sekadar realisasi dibagi RAP?',
        answer: (
          <>
            Karena pekerjaan yang belum dimulai belum mengeluarkan biaya, dan membandingkannya
            dengan seluruh rencana akan menyebutnya penghematan. Yang dibandingkan adalah biaya
            terhadap <em>bagian rencana yang sudah dikerjakan</em>. Seperempat dari rencana 80 juta
            berarti nilai dikerjakan 20 juta; habis 25 juta untuk sampai ke situ berarti CPI 0,8.
          </>
        ),
      },
    ],
  },
  {
    title: 'Menyusun harga',
    intro: 'Urutannya selalu sama: satuan, sumber daya, harga, lalu analisa.',
    entries: [
      {
        question: 'Dari mana koefisien AHSP diambil?',
        answer: (
          <>
            Bisa diketik sendiri, atau diambil dari{' '}
            <Link className="underline underline-offset-4" href="/master-data/ahsp-library">
              Pustaka AHSP
            </Link>{' '}
            — analisa terbitan resmi beserta sumbernya. Yang diambil hanya koefisiennya; harganya
            tetap dari katalog Anda sendiri, karena harga pasar tiap daerah berbeda.
          </>
        ),
      },
      {
        question: 'Sumber daya di pustaka tidak cocok dengan katalog saya.',
        answer: (
          <>
            Wajar: sebagian besar baris di pustaka nasional hanya menyebut nama tanpa kode.
            Saat analisa diterapkan, yang cocok disalin dan yang tidak dilaporkan namanya.
            Tambahkan sumber dayanya di Master Data, lalu terapkan lagi.
          </>
        ),
      },
      {
        question: 'Bisakah kebutuhan diisi langsung tanpa koefisien?',
        answer: (
          <>
            Bisa. Isi ruas <strong>Kebutuhan</strong> pada baris analisa. Angka itu dipakai apa
            adanya — tidak dikalikan volume lagi dan tidak ditambah susut — dan biaya barisnya
            mengikutinya.
          </>
        ),
      },
    ],
  },
  {
    title: 'Progres dan penagihan',
    intro: 'Progres dicatat per periode, disetujui, lalu menjadi dasar opname dan termin.',
    entries: [
      {
        question: 'Kenapa progres saya belum masuk hitungan?',
        answer: (
          <>
            Hanya entri berstatus <strong>Disetujui</strong> yang dihitung. Draf dan yang masih
            diajukan sengaja tidak ikut, supaya angka yang dilaporkan ke pemilik tidak berubah
            sendiri saat seseorang masih mengetik.
          </>
        ),
      },
      {
        question: 'Apa gunanya ruas Lokasi?',
        answer: (
          <>
            Membuat catatan dapat diperiksa ulang sebulan kemudian. Dua entri pada pekerjaan dan
            periode yang sama tidak bisa dibedakan tanpa itu, dan perdebatan soal apakah salah
            satunya sudah pernah dihitung jadi tidak punya bukti.
          </>
        ),
      },
      {
        question: 'Beda Laporan Opname dan Laporan RAP?',
        answer: (
          <>
            Opname dokumen kontrak: progres terhadap RAB, ditandatangani, dasar penagihan. Laporan
            RAP untuk dapur sendiri: ke mana uang periode ini pergi. Keduanya membaca catatan yang
            sama, ditulis untuk pembaca yang berbeda.
          </>
        ),
      },
    ],
  },
  {
    title: 'Material, gudang, dan mandor',
    intro: 'Semua yang keluar uang bermuara ke satu tempat: Kendali Biaya.',
    entries: [
      {
        question: 'Kapan material menjadi biaya?',
        answer: (
          <>
            Saat keluar dari gudang ke sebuah pekerjaan, bukan saat dibeli. Yang sudah dibeli tapi
            belum terpasang adalah stok, dan selisihnya terbaca di blok{' '}
            <strong>Beli vs terpasang</strong>.
          </>
        ),
      },
      {
        question: 'Kapan saya harus memesan material?',
        answer: (
          <>
            Lihat <strong>Rencana Pengadaan</strong>. Tanggalnya dihitung mundur dari tanggal mulai
            pekerjaan yang memakainya, dikurangi lead time pemasok dan margin pengaman. Material
            yang pekerjaannya belum dijadwalkan tidak diberi tanggal — bukan lupa, memang belum
            bisa dihitung.
          </>
        ),
      },
      {
        question: 'Kasbon mandor dihitung sebagai biaya?',
        answer: (
          <>
            Tidak. Kasbon uang yang berpindah sebelum ada yang diukur; ia menjadi biaya saat
            sertifikat menyatakannya. Di Laporan RAP kasbon tetap ditampilkan supaya kas yang
            keluar terlihat, tapi tidak ikut dijumlahkan.
          </>
        ),
      },
      {
        question: 'Gudang pusat itu untuk apa?',
        answer: (
          <>
            Untuk pembelian borongan yang dibagi ke beberapa proyek. Barang diterima sekali, lalu
            dikirim ke proyek sesuai kebutuhan pada harga rata-rata tertimbang. Sejak masuk ke
            proyek, ia berperilaku persis seperti material yang dibeli proyek itu sendiri.
          </>
        ),
      },
    ],
  },
  {
    title: 'Perubahan kontrak',
    intro: '',
    entries: [
      {
        question: 'Bagaimana mencatat pekerjaan tambah/kurang?',
        answer: (
          <>
            Lewat <strong>Pekerjaan Tambah/Kurang</strong>. Saat revisi disetujui, volumenya
            diterapkan, nilai kontrak diperbarui, dan Baseline&nbsp;0 dikunci otomatis bila belum.
            Isi juga perpanjangan waktunya — itu yang menjadi dasar klaim keterlambatan, dan tidak
            bisa dihitung sendiri oleh sistem karena hasil negosiasi.
          </>
        ),
      },
      {
        question: 'Nomor dokumen harus diisi manual?',
        answer: (
          <>
            Tidak. Kosongkan saja dan sistem memberi nomor berurutan per proyek. Kalau dokumennya
            datang membawa nomor pihak lain — nota pemasok, berita acara lapangan — ketik nomor itu
            dan ia dipertahankan.
          </>
        ),
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <PageHeader
        title="Petunjuk"
        description="Jawaban atas pertanyaan yang benar-benar sering muncul, bukan keliling menu. Menu sudah menunjukkan letak tombolnya; yang tidak bisa ditunjukkannya adalah angka mana di antara dua yang mirip yang seharusnya Anda baca."
      />

      {SECTIONS.map((section) => (
        <section key={section.title} className="space-y-4">
          <div className="border-b pb-2">
            <h2 className="font-semibold">{section.title}</h2>
            {section.intro === '' ? null : (
              <p className="mt-1 text-sm text-muted-foreground">{section.intro}</p>
            )}
          </div>

          <dl className="space-y-4">
            {section.entries.map((entry) => (
              <div key={entry.question} className="space-y-1">
                <dt className="text-sm font-medium">{entry.question}</dt>
                <dd className="text-sm text-muted-foreground">{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <p className="border-t pt-4 text-xs text-muted-foreground">
        Prinsip yang dipakai di seluruh aplikasi: input sedikit, sistem menghitung banyak. Tidak
        ada angka yang diketik dua kali, dan setiap angka di layar dapat ditelusuri ke catatan yang
        menghasilkannya.
      </p>
    </div>
  );
}
