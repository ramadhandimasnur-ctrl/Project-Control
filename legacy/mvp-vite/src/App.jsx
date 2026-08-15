import { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Settings2, Boxes, Hammer, Sigma, PackageSearch,
  Plus, Pencil, Trash2, Search, X, AlertTriangle, Info, RotateCcw
} from "lucide-react";

/* ============================================================
   PROJECT CONTROL — MVP Tahap 1
   Lapisan: Data (persist) → Calculation (fungsi murni) → UI
   ============================================================ */

const KEY = "project-control-v1";
const KATEGORI = ["Tenaga", "Material", "Alat"];

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const N = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const rp = (v) => "Rp " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.round(N(v)));
const qty = (v, d = 4) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(N(v));

const EMPTY = {
  project: { id: "p1", nama: "", nilai_kontrak: 0, tanggal_mulai: "", durasi: 0, satuan_waktu: "hari" },
  resources: [],
  pekerjaan: [],
  analisa: [],
};

/* ---------- Lapisan perhitungan: fungsi murni, tanpa efek samping ---------- */
function compute(db) {
  const byId = new Map(db.resources.map((r) => [r.id, r]));

  const jobs = db.pekerjaan.map((p) => {
    const items = db.analisa
      .filter((a) => a.pekerjaan_id === p.id)
      .map((a) => {
        const r = byId.get(a.resource_id) || null;
        const kRab = N(a.koef);
        const kRap = a.koef_rap === null || a.koef_rap === undefined ? kRab : N(a.koef_rap);
        const hRab = N(r?.harga_rab);
        const hRap = N(r?.harga_rap);
        const qRab = N(p.volume) * kRab;
        const qRap = N(p.volume) * kRap;
        return {
          ...a, resource: r, kRab, kRap, hRab, hRap, qRab, qRap,
          nRab: qRab * hRab,
          nRap: qRap * hRap,
          hsRab: kRab * hRab,   // kontribusi ke harga satuan pekerjaan
          hsRap: kRap * hRap,
        };
      })
      .sort((a, b) => {
        const ka = KATEGORI.indexOf(a.resource?.kategori) - KATEGORI.indexOf(b.resource?.kategori);
        return ka !== 0 ? ka : (a.resource?.kode || "").localeCompare(b.resource?.kode || "");
      });

    const totalRab = items.reduce((s, i) => s + i.nRab, 0);
    const totalRap = items.reduce((s, i) => s + i.nRap, 0);
    return {
      ...p, items, totalRab, totalRap,
      selisih: totalRab - totalRap,
      hsRab: items.reduce((s, i) => s + i.hsRab, 0),
      hsRap: items.reduce((s, i) => s + i.hsRap, 0),
    };
  });

  const totalRab = jobs.reduce((s, j) => s + j.totalRab, 0);
  const totalRap = jobs.reduce((s, j) => s + j.totalRap, 0);

  // Rekap kebutuhan: GROUP BY resource lintas seluruh pekerjaan
  const map = new Map();
  jobs.forEach((j) =>
    j.items.forEach((i) => {
      if (!i.resource) return;
      const cur = map.get(i.resource.id) || {
        resource: i.resource, qRab: 0, qRap: 0, nRab: 0, nRap: 0, dipakai: [],
      };
      cur.qRab += i.qRab;
      cur.qRap += i.qRap;
      cur.nRab += i.nRab;
      cur.nRap += i.nRap;
      cur.dipakai.push({ kode: j.kode, nama: j.nama, q: i.qRab });
      map.set(i.resource.id, cur);
    })
  );
  const rekap = [...map.values()].sort((a, b) => b.nRap - a.nRap);

  const kontrak = N(db.project.nilai_kontrak);
  return {
    jobs, rekap, totalRab, totalRap,
    selisih: totalRab - totalRap,
    labaRencana: kontrak - totalRap,
    marginPct: kontrak > 0 ? ((kontrak - totalRap) / kontrak) * 100 : 0,
  };
}

/* ---------- Contoh data (opsional, dipicu user — bukan hard-code sistem) ---------- */
function contohData() {
  const R = (kode, nama, kategori, satuan, hrab, hrap) => ({
    id: uid(), kode, nama, kategori, satuan, harga_rab: hrab, harga_rap: hrap, aktif: true,
  });
  const resources = [
    R("L.01", "Pekerja", "Tenaga", "OH", 150000, 140000),
    R("L.02", "Tukang besi", "Tenaga", "OH", 190000, 180000),
    R("L.03", "Mandor", "Tenaga", "OH", 220000, 210000),
    R("M.01", "Besi beton D13", "Material", "kg", 14500, 13200),
    R("M.02", "Semen PC 50 kg", "Material", "zak", 68000, 63500),
    R("M.03", "Pasir beton", "Material", "m3", 320000, 295000),
    R("M.04", "Batu pecah 2/3", "Material", "m3", 385000, 360000),
    R("E.01", "Concrete mixer", "Alat", "hari", 350000, 300000),
  ];
  const f = (k) => resources.find((r) => r.kode === k).id;
  const pekerjaan = [
    { id: uid(), kode: "A.01", nama: "Kolom beton K1 fc 25", satuan: "m3", volume: 10 },
    { id: uid(), kode: "A.02", nama: "Balok beton B1 fc 25", satuan: "m3", volume: 14 },
  ];
  const [A, B] = pekerjaan;
  const a = (pid, kode, koef) => ({ id: uid(), pekerjaan_id: pid, resource_id: f(kode), koef, koef_rap: null });
  const analisa = [
    a(A.id, "M.01", 50), a(A.id, "M.02", 7.5), a(A.id, "M.03", 0.54), a(A.id, "M.04", 0.82),
    a(A.id, "L.01", 2.1), a(A.id, "L.02", 0.7), a(A.id, "L.03", 0.105), a(A.id, "E.01", 0.25),
    a(B.id, "M.01", 50), a(B.id, "M.02", 7.5), a(B.id, "M.03", 0.54), a(B.id, "M.04", 0.82),
    a(B.id, "L.01", 1.9), a(B.id, "L.02", 0.65), a(B.id, "L.03", 0.095), a(B.id, "E.01", 0.25),
  ];
  return {
    project: { id: "p1", nama: "Pembangunan Gudang Logistik Tahap 1", nilai_kontrak: 2500000000, tanggal_mulai: "2026-09-01", durasi: 180, satuan_waktu: "hari" },
    resources, pekerjaan, analisa,
  };
}

/* ============================ Atom UI ============================ */

function Btn({ children, onClick, variant = "ghost", size = "md", type = "button", disabled, className = "" }) {
  const v = {
    primary: "bg-blue-700 text-white hover:bg-blue-800 border-blue-700",
    ghost: "bg-white text-slate-700 hover:bg-slate-50 border-slate-300",
    danger: "bg-white text-rose-700 hover:bg-rose-50 border-rose-200",
    solidDanger: "bg-rose-600 text-white hover:bg-rose-700 border-rose-600",
  }[variant];
  const s = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 border rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed ${v} ${s} ${className}`}>
      {children}
    </button>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";

function TxtInput(props) {
  return <input {...props} className={`${inputCls} ${props.className || ""}`} />;
}

/* Input angka dengan buffer teks lokal supaya "0." dan "1,5" tidak dirusak saat mengetik */
function NumInput({ value, onChange, className = "", align = "right", placeholder = "0", title }) {
  const [txt, setTxt] = useState(value === 0 || value ? String(value) : "");
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setTxt(value === 0 || value ? String(value) : "");
  }, [value, focus]);
  return (
    <input
      title={title}
      value={txt}
      placeholder={placeholder}
      inputMode="decimal"
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".");
        if (raw !== "" && !/^-?\d*\.?\d*$/.test(raw)) return;
        setTxt(raw);
        const n = parseFloat(raw);
        onChange(isNaN(n) ? 0 : n);
      }}
      className={`${inputCls} font-mono tabular-nums ${align === "right" ? "text-right" : ""} ${className}`}
    />
  );
}

function Modal({ open, title, onClose, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900 bg-opacity-50 p-4">
      <div className={`bg-white rounded-lg shadow-xl w-full mt-10 ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Kode({ children }) {
  return <span className="font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">{children}</span>;
}

function KatBadge({ k }) {
  const c = { Tenaga: "bg-violet-50 text-violet-700 border-violet-200", Material: "bg-amber-50 text-amber-800 border-amber-200", Alat: "bg-teal-50 text-teal-700 border-teal-200" }[k] || "bg-slate-50 text-slate-600 border-slate-200";
  return <span className={`text-xs px-1.5 py-0.5 rounded border ${c}`}>{k}</span>;
}

function Panel({ title, desc, right, children }) {
  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm">
      {(title || right) && (
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="font-semibold text-slate-900">{title}</h2>
            {desc && <p className="text-xs text-slate-500 mt-0.5">{desc}</p>}
          </div>
          <div className="flex items-center gap-2">{right}</div>
        </div>
      )}
      {children}
    </section>
  );
}

function Empty({ icon: Icon, title, children }) {
  return (
    <div className="px-5 py-14 text-center">
      <Icon className="mx-auto text-slate-300" size={32} />
      <p className="mt-3 font-medium text-slate-700">{title}</p>
      <div className="mt-1 text-sm text-slate-500">{children}</div>
    </div>
  );
}

const th = "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide";
const thR = th + " text-right";
const td = "px-3 py-1.5 text-sm text-slate-800";
const tdR = td + " text-right font-mono tabular-nums";

/* ============================ Halaman ============================ */

function Dashboard({ db, c, go }) {
  const kontrak = N(db.project.nilai_kontrak);
  const bar = kontrak > 0 ? Math.min(100, (c.totalRap / kontrak) * 100) : 0;
  const barRab = kontrak > 0 ? Math.min(100, (c.totalRab / kontrak) * 100) : 0;
  const material = c.rekap.filter((r) => r.resource.kategori === "Material");

  const Stat = ({ label, value, sub, tone }) => (
    <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 font-mono tabular-nums text-xl ${tone || "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Nilai kontrak" value={rp(kontrak)} sub={db.project.nama || "Proyek belum diberi nama"} />
        <Stat label="Total RAB" value={rp(c.totalRab)} sub={`${c.jobs.length} pekerjaan`} />
        <Stat label="Total RAP" value={rp(c.totalRap)} sub="Rencana biaya pelaksanaan" />
        <Stat label="Selisih RAB − RAP" value={rp(c.selisih)} tone={c.selisih >= 0 ? "text-emerald-700" : "text-rose-700"} sub={c.totalRab > 0 ? `${((c.selisih / c.totalRab) * 100).toFixed(2)}% dari RAB` : "—"} />
      </div>

      {/* Signature: dekomposisi nilai kontrak */}
      <Panel title="Posisi biaya terhadap kontrak" desc="RAP adalah biaya yang direncanakan keluar. Sisanya laba kotor rencana.">
        <div className="px-5 py-5">
          {kontrak <= 0 ? (
            <p className="text-sm text-slate-500">Isi nilai kontrak di halaman Proyek untuk melihat posisi margin.</p>
          ) : (
            <>
              <div className="relative h-9 w-full bg-slate-100 rounded overflow-hidden border border-slate-200">
                <div className={`absolute inset-y-0 left-0 ${c.labaRencana >= 0 ? "bg-blue-700" : "bg-rose-600"}`} style={{ width: `${bar}%` }} />
                <div className="absolute inset-y-0 border-l-2 border-dashed border-slate-900" style={{ left: `${barRab}%` }} title="Total RAB" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-700 inline-block" /> RAP {rp(c.totalRap)}</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-100 border border-slate-300 inline-block" /> Laba kotor rencana {rp(c.labaRencana)} ({c.marginPct.toFixed(2)}%)</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-0 h-3 border-l-2 border-dashed border-slate-900 inline-block" /> Total RAB {rp(c.totalRab)}</span>
              </div>
              {c.totalRab > kontrak * 1.001 && (
                <p className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  Total RAB melampaui nilai kontrak. Periksa apakah nilai kontrak sudah termasuk PPN dan overhead sementara RAB belum, atau memang ada volume yang salah.
                </p>
              )}
            </>
          )}
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Pekerjaan dengan biaya terbesar">
          {c.jobs.length === 0 ? (
            <Empty icon={Hammer} title="Belum ada pekerjaan">
              <button onClick={() => go("pekerjaan")} className="text-blue-700 underline">Tambahkan pekerjaan</button> untuk mulai menghitung.
            </Empty>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr><th className={th}>Pekerjaan</th><th className={thR}>RAB</th><th className={thR}>RAP</th><th className={thR}>Selisih</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...c.jobs].sort((a, b) => b.totalRab - a.totalRab).slice(0, 6).map((j) => (
                  <tr key={j.id}>
                    <td className={td}><Kode>{j.kode}</Kode> <span className="ml-1.5">{j.nama}</span></td>
                    <td className={tdR}>{rp(j.totalRab)}</td>
                    <td className={tdR}>{rp(j.totalRap)}</td>
                    <td className={`${tdR} ${j.selisih >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{rp(j.selisih)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Kebutuhan material" desc="Kebutuhan teoritis dari koefisien. Belum termasuk pembulatan kemasan atau sisa potongan.">
          {material.length === 0 ? (
            <Empty icon={PackageSearch} title="Belum ada material terpakai">Masukkan resource material pada analisa pekerjaan.</Empty>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr><th className={th}>Material</th><th className={thR}>Kebutuhan</th><th className={thR}>Nilai RAP</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {material.slice(0, 6).map((r) => (
                  <tr key={r.resource.id}>
                    <td className={td}><Kode>{r.resource.kode}</Kode> <span className="ml-1.5">{r.resource.nama}</span></td>
                    <td className={tdR}>{qty(r.qRab, 2)} <span className="text-slate-400">{r.resource.satuan}</span></td>
                    <td className={tdR}>{rp(r.nRap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ProjectPage({ db, set, reset, loadDemo }) {
  const p = db.project;
  const upd = (k, v) => set((d) => ({ ...d, project: { ...d.project, [k]: v } }));
  return (
    <div className="space-y-5">
      <Panel title="Data proyek" desc="Durasi dan satuan waktu belum dipakai perhitungan; keduanya baru aktif pada modul schedule.">
        <div className="p-5 grid md:grid-cols-2 gap-4 max-w-3xl">
          <div className="md:col-span-2">
            <Field label="Nama proyek">
              <TxtInput value={p.nama} onChange={(e) => upd("nama", e.target.value)} placeholder="Pembangunan Gudang Logistik Tahap 1" />
            </Field>
          </div>
          <Field label="Nilai kontrak (Rp)" hint={N(p.nilai_kontrak) > 0 ? rp(p.nilai_kontrak) : "Dipakai untuk menghitung laba kotor rencana"}>
            <NumInput value={p.nilai_kontrak} onChange={(v) => upd("nilai_kontrak", v)} align="left" />
          </Field>
          <Field label="Tanggal mulai">
            <TxtInput type="date" value={p.tanggal_mulai} onChange={(e) => upd("tanggal_mulai", e.target.value)} />
          </Field>
          <Field label="Durasi proyek">
            <NumInput value={p.durasi} onChange={(v) => upd("durasi", v)} align="left" />
          </Field>
          <Field label="Satuan waktu">
            <select value={p.satuan_waktu} onChange={(e) => upd("satuan_waktu", e.target.value)} className={inputCls}>
              <option value="hari">Hari</option>
              <option value="minggu">Minggu</option>
            </select>
          </Field>
        </div>
      </Panel>

      <Panel title="Data aplikasi" desc="Seluruh data tersimpan otomatis setiap kali Anda mengubah sesuatu.">
        <div className="p-5 flex flex-wrap gap-2">
          <Btn onClick={loadDemo}><Info size={14} /> Muat contoh data</Btn>
          <Btn variant="danger" onClick={reset}><RotateCcw size={14} /> Kosongkan semua data</Btn>
        </div>
      </Panel>
    </div>
  );
}

function ResourcePage({ db, set, confirm }) {
  const [q, setQ] = useState("");
  const [kat, setKat] = useState("Semua");
  const [aktif, setAktif] = useState("Semua");
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");

  const rows = db.resources.filter((r) => {
    const s = (r.kode + " " + r.nama).toLowerCase();
    return s.includes(q.toLowerCase()) &&
      (kat === "Semua" || r.kategori === kat) &&
      (aktif === "Semua" || (aktif === "Aktif") === !!r.aktif);
  });

  const open = (r) => { setErr(""); setForm(r ? { ...r } : { id: null, kode: "", nama: "", kategori: "Material", satuan: "", harga_rab: 0, harga_rap: 0, aktif: true }); };

  const save = () => {
    const f = { ...form, kode: form.kode.trim().toUpperCase(), nama: form.nama.trim(), satuan: form.satuan.trim() };
    if (!f.kode || !f.nama || !f.satuan) return setErr("Kode, nama, dan satuan wajib diisi.");
    if (db.resources.some((r) => r.kode === f.kode && r.id !== f.id)) return setErr(`Kode ${f.kode} sudah dipakai resource lain.`);
    set((d) => ({ ...d, resources: f.id ? d.resources.map((r) => (r.id === f.id ? f : r)) : [...d.resources, { ...f, id: uid() }] }));
    setForm(null);
  };

  const del = (r) => {
    const pakai = db.analisa.filter((a) => a.resource_id === r.id);
    if (pakai.length) {
      const nm = [...new Set(pakai.map((a) => db.pekerjaan.find((p) => p.id === a.pekerjaan_id)?.kode).filter(Boolean))];
      return confirm({
        title: "Resource tidak bisa dihapus",
        body: `${r.kode} — ${r.nama} masih dipakai pada ${pakai.length} baris analisa (${nm.join(", ")}). Hapus dulu barisnya, atau nonaktifkan resource ini agar tidak muncul saat menyusun analisa baru.`,
        okLabel: null,
      });
    }
    confirm({
      title: "Hapus resource?",
      body: `${r.kode} — ${r.nama} akan dihapus permanen.`,
      okLabel: "Hapus",
      onOk: () => set((d) => ({ ...d, resources: d.resources.filter((x) => x.id !== r.id) })),
    });
  };

  return (
    <Panel
      title="Master resource"
      desc="Satu resource = satu satuan. Harga RAB dan RAP diisi manual dan menjadi rujukan seluruh analisa."
      right={
        <>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode atau nama" className={`${inputCls} pl-7 w-52`} />
          </div>
          <select value={kat} onChange={(e) => setKat(e.target.value)} className={`${inputCls} w-32`}>
            <option>Semua</option>{KATEGORI.map((k) => <option key={k}>{k}</option>)}
          </select>
          <select value={aktif} onChange={(e) => setAktif(e.target.value)} className={`${inputCls} w-28`}>
            <option>Semua</option><option>Aktif</option><option>Nonaktif</option>
          </select>
          <Btn variant="primary" onClick={() => open(null)}><Plus size={14} /> Tambah resource</Btn>
        </>
      }
    >
      {db.resources.length === 0 ? (
        <Empty icon={Boxes} title="Belum ada resource">Tambahkan tenaga, material, dan alat beserta harga RAB dan RAP-nya.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className={th}>Kode</th><th className={th}>Nama</th><th className={th}>Kategori</th><th className={th}>Satuan</th>
                <th className={thR}>Harga RAB</th><th className={thR}>Harga RAP</th><th className={thR}>Selisih</th>
                <th className={th}>Status</th><th className={thR}>Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={r.aktif ? "" : "bg-slate-50 text-slate-400"}>
                  <td className={td}><Kode>{r.kode}</Kode></td>
                  <td className={td}>{r.nama}</td>
                  <td className={td}><KatBadge k={r.kategori} /></td>
                  <td className={td}>{r.satuan}</td>
                  <td className={tdR}>{rp(r.harga_rab)}</td>
                  <td className={tdR}>{rp(r.harga_rap)}</td>
                  <td className={`${tdR} ${r.harga_rab - r.harga_rap >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{rp(r.harga_rab - r.harga_rap)}</td>
                  <td className={td}>
                    <button onClick={() => set((d) => ({ ...d, resources: d.resources.map((x) => x.id === r.id ? { ...x, aktif: !x.aktif } : x) }))}
                      className={`text-xs px-2 py-0.5 rounded border ${r.aktif ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                      {r.aktif ? "Aktif" : "Nonaktif"}
                    </button>
                  </td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    <Btn size="sm" onClick={() => open(r)}><Pencil size={12} /></Btn>{" "}
                    <Btn size="sm" variant="danger" onClick={() => del(r)}><Trash2 size={12} /></Btn>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="px-5 py-8 text-center text-sm text-slate-500">Tidak ada resource yang cocok dengan filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} title={form?.id ? "Ubah resource" : "Tambah resource"} onClose={() => setForm(null)}>
        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kode"><TxtInput value={form.kode} onChange={(e) => setForm({ ...form, kode: e.target.value })} placeholder="M.01" className="font-mono" /></Field>
              <Field label="Kategori">
                <select value={form.kategori} onChange={(e) => setForm({ ...form, kategori: e.target.value })} className={inputCls}>
                  {KATEGORI.map((k) => <option key={k}>{k}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Nama"><TxtInput value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="Besi beton D13" /></Field>
            <Field label="Satuan" hint="Satuan mengunci penjumlahan kebutuhan. Ubah dengan hati-hati bila sudah dipakai.">
              <TxtInput value={form.satuan} onChange={(e) => setForm({ ...form, satuan: e.target.value })} placeholder="kg" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Harga RAB" hint={rp(form.harga_rab)}><NumInput value={form.harga_rab} onChange={(v) => setForm({ ...form, harga_rab: v })} /></Field>
              <Field label="Harga RAP" hint={rp(form.harga_rap)}><NumInput value={form.harga_rap} onChange={(v) => setForm({ ...form, harga_rap: v })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} className="rounded border-slate-300" />
              Aktif
            </label>
            {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn onClick={() => setForm(null)}>Batal</Btn>
              <Btn variant="primary" onClick={save}>Simpan</Btn>
            </div>
          </div>
        )}
      </Modal>
    </Panel>
  );
}

function PekerjaanPage({ db, set, c, confirm, go }) {
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");
  const rows = c.jobs.filter((j) => (j.kode + " " + j.nama).toLowerCase().includes(q.toLowerCase()));

  const save = () => {
    const f = { ...form, kode: form.kode.trim().toUpperCase(), nama: form.nama.trim(), satuan: form.satuan.trim() };
    if (!f.kode || !f.nama || !f.satuan) return setErr("Kode, nama, dan satuan wajib diisi.");
    if (db.pekerjaan.some((p) => p.kode === f.kode && p.id !== f.id)) return setErr(`Kode ${f.kode} sudah dipakai pekerjaan lain.`);
    set((d) => ({ ...d, pekerjaan: f.id ? d.pekerjaan.map((p) => (p.id === f.id ? f : p)) : [...d.pekerjaan, { ...f, id: uid() }] }));
    setForm(null);
  };

  const del = (j) => confirm({
    title: "Hapus pekerjaan?",
    body: `${j.kode} — ${j.nama} beserta ${j.items.length} baris analisanya akan dihapus.`,
    okLabel: "Hapus",
    onOk: () => set((d) => ({ ...d, pekerjaan: d.pekerjaan.filter((p) => p.id !== j.id), analisa: d.analisa.filter((a) => a.pekerjaan_id !== j.id) })),
  });

  return (
    <Panel
      title="Pekerjaan"
      desc="Volume bisa diubah langsung di tabel. Seluruh nilai RAB, RAP, dan kebutuhan material ikut terhitung ulang."
      right={
        <>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari pekerjaan" className={`${inputCls} pl-7 w-52`} />
          </div>
          <Btn variant="primary" onClick={() => { setErr(""); setForm({ id: null, kode: "", nama: "", satuan: "", volume: 0 }); }}>
            <Plus size={14} /> Tambah pekerjaan
          </Btn>
        </>
      }
    >
      {c.jobs.length === 0 ? (
        <Empty icon={Hammer} title="Belum ada pekerjaan">Buat item pekerjaan, lalu susun analisanya untuk mendapatkan RAB dan RAP.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className={th}>Kode</th><th className={th}>Nama pekerjaan</th><th className={th}>Satuan</th><th className={thR}>Volume</th>
                <th className={thR}>Harga satuan RAB</th><th className={thR}>Total RAB</th><th className={thR}>Total RAP</th><th className={thR}>Selisih</th>
                <th className={thR}>Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((j) => (
                <tr key={j.id}>
                  <td className={td}><Kode>{j.kode}</Kode></td>
                  <td className={td}>
                    <button onClick={() => go("analisa", j.id)} className="text-blue-700 hover:underline text-left">{j.nama}</button>
                    <span className="ml-2 text-xs text-slate-400">{j.items.length} resource</span>
                  </td>
                  <td className={td}>{j.satuan}</td>
                  <td className="px-3 py-1 w-28"><NumInput value={j.volume} onChange={(v) => set((d) => ({ ...d, pekerjaan: d.pekerjaan.map((p) => p.id === j.id ? { ...p, volume: v } : p) }))} className="py-1" /></td>
                  <td className={tdR}>{rp(j.hsRab)}</td>
                  <td className={tdR}>{rp(j.totalRab)}</td>
                  <td className={tdR}>{rp(j.totalRap)}</td>
                  <td className={`${tdR} ${j.selisih >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{rp(j.selisih)}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    <Btn size="sm" onClick={() => { setErr(""); setForm({ id: j.id, kode: j.kode, nama: j.nama, satuan: j.satuan, volume: j.volume }); }}><Pencil size={12} /></Btn>{" "}
                    <Btn size="sm" variant="danger" onClick={() => del(j)}><Trash2 size={12} /></Btn>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t-2 border-slate-300">
              <tr>
                <td className={`${td} font-semibold`} colSpan={5}>Total proyek</td>
                <td className={`${tdR} font-semibold`}>{rp(c.totalRab)}</td>
                <td className={`${tdR} font-semibold`}>{rp(c.totalRap)}</td>
                <td className={`${tdR} font-semibold ${c.selisih >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{rp(c.selisih)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal open={!!form} title={form?.id ? "Ubah pekerjaan" : "Tambah pekerjaan"} onClose={() => setForm(null)}>
        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kode"><TxtInput value={form.kode} onChange={(e) => setForm({ ...form, kode: e.target.value })} placeholder="A.01" className="font-mono" /></Field>
              <Field label="Satuan"><TxtInput value={form.satuan} onChange={(e) => setForm({ ...form, satuan: e.target.value })} placeholder="m3" /></Field>
            </div>
            <Field label="Nama pekerjaan"><TxtInput value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="Kolom beton K1 fc 25" /></Field>
            <Field label="Volume"><NumInput value={form.volume} onChange={(v) => setForm({ ...form, volume: v })} /></Field>
            {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn onClick={() => setForm(null)}>Batal</Btn>
              <Btn variant="primary" onClick={save}>Simpan</Btn>
            </div>
          </div>
        )}
      </Modal>
    </Panel>
  );
}

function AnalisaPage({ db, set, c, sel, setSel, confirm }) {
  const [pick, setPick] = useState("");
  const [koef, setKoef] = useState(0);
  const [err, setErr] = useState("");

  const job = c.jobs.find((j) => j.id === sel) || c.jobs[0];
  useEffect(() => { if (!sel && c.jobs[0]) setSel(c.jobs[0].id); }, [sel, c.jobs, setSel]);

  if (c.jobs.length === 0)
    return <Panel title="Analisa dan koefisien"><Empty icon={Sigma} title="Belum ada pekerjaan">Buat pekerjaan lebih dulu, lalu susun analisanya di sini.</Empty></Panel>;
  if (!job) return null;

  const tersedia = db.resources.filter((r) => r.aktif && !job.items.some((i) => i.resource_id === r.id))
    .sort((a, b) => a.kode.localeCompare(b.kode));

  const tambah = () => {
    if (!pick) return setErr("Pilih kode resource lebih dulu.");
    set((d) => ({ ...d, analisa: [...d.analisa, { id: uid(), pekerjaan_id: job.id, resource_id: pick, koef: N(koef), koef_rap: null }] }));
    setPick(""); setKoef(0); setErr("");
  };
  const updKoef = (id, k, v) => set((d) => ({ ...d, analisa: d.analisa.map((a) => (a.id === id ? { ...a, [k]: v } : a)) }));
  const hapus = (row) => confirm({
    title: "Hapus baris analisa?",
    body: `${row.resource?.kode} — ${row.resource?.nama} akan dikeluarkan dari ${job.kode}.`,
    okLabel: "Hapus",
    onOk: () => set((d) => ({ ...d, analisa: d.analisa.filter((a) => a.id !== row.id) })),
  });

  return (
    <div className="space-y-5">
      <Panel
        title="Analisa dan koefisien"
        desc="Nama, kategori, satuan, dan harga terisi otomatis dari kode resource."
        right={
          <select value={job.id} onChange={(e) => setSel(e.target.value)} className={`${inputCls} w-80`}>
            {c.jobs.map((j) => <option key={j.id} value={j.id}>{j.kode} — {j.nama}</option>)}
          </select>
        }
      >
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span className="text-slate-600">Volume pekerjaan <b className="font-mono tabular-nums text-slate-900">{qty(job.volume)}</b> {job.satuan}</span>
          <span className="text-slate-600">Harga satuan RAB <b className="font-mono tabular-nums text-slate-900">{rp(job.hsRab)}</b> /{job.satuan}</span>
          <span className="text-slate-600">Harga satuan RAP <b className="font-mono tabular-nums text-slate-900">{rp(job.hsRap)}</b> /{job.satuan}</span>
        </div>

        <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-end gap-3">
          <div className="w-96">
            <Field label="Kode resource">
              <select value={pick} onChange={(e) => { setPick(e.target.value); setErr(""); }} className={inputCls}>
                <option value="">Pilih resource…</option>
                {KATEGORI.map((k) => {
                  const g = tersedia.filter((r) => r.kategori === k);
                  return g.length ? <optgroup key={k} label={k}>{g.map((r) => <option key={r.id} value={r.id}>{r.kode} — {r.nama} ({r.satuan})</option>)}</optgroup> : null;
                })}
              </select>
            </Field>
          </div>
          <div className="w-32"><Field label="Koefisien"><NumInput value={koef} onChange={setKoef} /></Field></div>
          <Btn variant="primary" onClick={tambah}><Plus size={14} /> Tambah baris</Btn>
          {err && <span className="text-sm text-rose-700">{err}</span>}
          {tersedia.length === 0 && <span className="text-sm text-slate-500">Semua resource aktif sudah masuk di pekerjaan ini.</span>}
        </div>

        {job.items.length === 0 ? (
          <Empty icon={Sigma} title="Analisa masih kosong">Tambahkan resource beserta koefisiennya untuk membentuk harga satuan.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className={th}>Kode</th><th className={th}>Nama resource</th><th className={th}>Kategori</th><th className={th}>Satuan</th>
                  <th className={thR}>Koef RAB</th><th className={thR}>Koef RAP</th>
                  <th className={thR}>Harga RAB</th><th className={thR}>Harga RAP</th>
                  <th className={thR}>Volume × Koef</th>
                  <th className={thR}>Nilai RAB</th><th className={thR}>Nilai RAP</th><th className={thR}>Selisih</th><th className={thR}>Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {job.items.map((i) => (
                  <tr key={i.id}>
                    <td className={td}><Kode>{i.resource?.kode || "?"}</Kode></td>
                    <td className={td}>{i.resource?.nama || <span className="text-rose-600">Resource tidak ditemukan</span>}</td>
                    <td className={td}>{i.resource && <KatBadge k={i.resource.kategori} />}</td>
                    <td className={td}>{i.resource?.satuan}</td>
                    <td className="px-2 py-1 w-24"><NumInput value={i.koef} onChange={(v) => updKoef(i.id, "koef", v)} className="py-1" /></td>
                    <td className="px-2 py-1 w-24">
                      <NumInput value={i.kRap} onChange={(v) => updKoef(i.id, "koef_rap", v)} className={`py-1 ${i.koef_rap == null ? "text-slate-400" : ""}`} title="Kosongkan sama dengan koef RAB bila tidak ada efisiensi pelaksanaan" />
                    </td>
                    <td className={tdR}>{rp(i.hRab)}</td>
                    <td className={tdR}>{rp(i.hRap)}</td>
                    <td className={tdR}>{qty(i.qRab)} <span className="text-slate-400">{i.resource?.satuan}</span></td>
                    <td className={tdR}>{rp(i.nRab)}</td>
                    <td className={tdR}>{rp(i.nRap)}</td>
                    <td className={`${tdR} ${i.nRab - i.nRap >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{rp(i.nRab - i.nRap)}</td>
                    <td className={`${td} text-right`}><Btn size="sm" variant="danger" onClick={() => hapus(i)}><Trash2 size={12} /></Btn></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                <tr>
                  <td className={`${td} font-semibold`} colSpan={9}>Total pekerjaan {job.kode}</td>
                  <td className={`${tdR} font-semibold`}>{rp(job.totalRab)}</td>
                  <td className={`${tdR} font-semibold`}>{rp(job.totalRap)}</td>
                  <td className={`${tdR} font-semibold ${job.selisih >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{rp(job.selisih)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function RekapPage({ c }) {
  const [kat, setKat] = useState("Material");
  const [q, setQ] = useState("");
  const rows = c.rekap.filter((r) =>
    (kat === "Semua" || r.resource.kategori === kat) &&
    (r.resource.kode + " " + r.resource.nama).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <Panel
      title="Rekap kebutuhan"
      desc="Kebutuhan = Σ (volume pekerjaan × koefisien). Angka teoritis, belum memperhitungkan pembulatan kemasan, panjang lonjor, atau sisa potongan."
      right={
        <>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari resource" className={`${inputCls} pl-7 w-52`} />
          </div>
          <select value={kat} onChange={(e) => setKat(e.target.value)} className={`${inputCls} w-32`}>
            <option>Semua</option>{KATEGORI.map((k) => <option key={k}>{k}</option>)}
          </select>
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty icon={PackageSearch} title="Belum ada kebutuhan terhitung">Kebutuhan muncul otomatis setelah resource dipakai pada analisa pekerjaan.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className={th}>Kode</th><th className={th}>Nama</th><th className={th}>Kategori</th><th className={th}>Satuan</th>
                <th className={thR}>Kebutuhan RAB</th><th className={thR}>Kebutuhan RAP</th>
                <th className={thR}>Nilai RAB</th><th className={thR}>Nilai RAP</th>
                <th className={th}>Dipakai pada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.resource.id}>
                  <td className={td}><Kode>{r.resource.kode}</Kode></td>
                  <td className={td}>{r.resource.nama}</td>
                  <td className={td}><KatBadge k={r.resource.kategori} /></td>
                  <td className={td}>{r.resource.satuan}</td>
                  <td className={`${tdR} font-semibold`}>{qty(r.qRab, 2)}</td>
                  <td className={tdR}>{qty(r.qRap, 2)}</td>
                  <td className={tdR}>{rp(r.nRab)}</td>
                  <td className={tdR}>{rp(r.nRap)}</td>
                  <td className={`${td} text-xs text-slate-500`}>
                    {r.dipakai.map((d, k) => (
                      <span key={k} className="mr-2 whitespace-nowrap">{d.kode} <span className="font-mono">({qty(d.q, 2)})</span></span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t-2 border-slate-300">
              <tr>
                <td className={`${td} font-semibold`} colSpan={6}>Total nilai {kat === "Semua" ? "seluruh resource" : kat.toLowerCase()}</td>
                <td className={`${tdR} font-semibold`}>{rp(rows.reduce((s, r) => s + r.nRab, 0))}</td>
                <td className={`${tdR} font-semibold`}>{rp(rows.reduce((s, r) => s + r.nRap, 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ============================ Shell ============================ */

export default function App() {
  const [db, setDb] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [sel, setSel] = useState("");
  const [dialog, setDialog] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(KEY);
        if (r?.value) setDb({ ...EMPTY, ...JSON.parse(r.value) });
      } catch (e) {
        // belum ada data tersimpan — mulai dari kosong
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try { await window.storage.set(KEY, JSON.stringify(db)); setErr(""); }
      catch (e) { setErr("Perubahan terakhir gagal disimpan. Salin data penting sebelum menutup halaman."); }
    })();
  }, [db, loaded]);

  const c = useMemo(() => compute(db), [db]);
  const set = (fn) => setDb((d) => (typeof fn === "function" ? fn(d) : fn));
  const go = (t, id) => { setTab(t); if (id) setSel(id); };

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "project", label: "Proyek", icon: Settings2 },
    { id: "resource", label: "Master resource", icon: Boxes, count: db.resources.length },
    { id: "pekerjaan", label: "Pekerjaan", icon: Hammer, count: db.pekerjaan.length },
    { id: "analisa", label: "Analisa", icon: Sigma, count: db.analisa.length },
    { id: "rekap", label: "Rekap kebutuhan", icon: PackageSearch, count: c.rekap.length },
  ];

  if (!loaded) return <div className="min-h-screen bg-slate-100 flex items-center justify-center text-sm text-slate-500">Memuat data…</div>;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-900 text-white">
        <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400">Project control</div>
            <div className="font-semibold">{db.project.nama || "Proyek tanpa nama"}</div>
          </div>
          <div className="flex items-center gap-6 text-right">
            <div><div className="text-xs text-slate-400">Total RAB</div><div className="font-mono tabular-nums text-sm">{rp(c.totalRab)}</div></div>
            <div><div className="text-xs text-slate-400">Total RAP</div><div className="font-mono tabular-nums text-sm">{rp(c.totalRap)}</div></div>
            <div><div className="text-xs text-slate-400">Selisih</div><div className={`font-mono tabular-nums text-sm ${c.selisih >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{rp(c.selisih)}</div></div>
          </div>
        </div>
        <nav className="px-3 flex gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-blue-500 ${tab === n.id ? "border-blue-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
              <n.icon size={15} /> {n.label}
              {n.count > 0 && <span className="text-xs bg-slate-700 text-slate-300 rounded px-1.5">{n.count}</span>}
            </button>
          ))}
        </nav>
      </header>

      {err && <div className="px-5 py-2 bg-rose-600 text-white text-sm">{err}</div>}

      <main className="p-5 max-w-screen-2xl mx-auto">
        {tab === "dashboard" && <Dashboard db={db} c={c} go={go} />}
        {tab === "project" && (
          <ProjectPage db={db} set={set}
            loadDemo={() => setDialog({ title: "Muat contoh data?", body: "Data yang ada sekarang akan diganti dengan contoh 2 pekerjaan beton dan 8 resource.", okLabel: "Muat contoh", onOk: () => setDb(contohData()) })}
            reset={() => setDialog({ title: "Kosongkan semua data?", body: "Proyek, resource, pekerjaan, dan analisa akan dihapus permanen.", okLabel: "Kosongkan", onOk: () => setDb(EMPTY) })} />
        )}
        {tab === "resource" && <ResourcePage db={db} set={set} confirm={setDialog} />}
        {tab === "pekerjaan" && <PekerjaanPage db={db} set={set} c={c} confirm={setDialog} go={go} />}
        {tab === "analisa" && <AnalisaPage db={db} set={set} c={c} sel={sel} setSel={setSel} confirm={setDialog} />}
        {tab === "rekap" && <RekapPage c={c} />}
      </main>

      <Modal open={!!dialog} title={dialog?.title} onClose={() => setDialog(null)}>
        {dialog && (
          <>
            <p className="text-sm text-slate-600">{dialog.body}</p>
            <div className="flex justify-end gap-2 mt-5">
              <Btn onClick={() => setDialog(null)}>{dialog.okLabel ? "Batal" : "Tutup"}</Btn>
              {dialog.okLabel && <Btn variant="solidDanger" onClick={() => { dialog.onOk?.(); setDialog(null); }}>{dialog.okLabel}</Btn>}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
