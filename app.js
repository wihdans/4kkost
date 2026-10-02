// ==========================================
// 1. KONEKSI SUPABASE CLOUD & INISIALISASI
// ==========================================
const SUPABASE_URL = 'https://sdbkltedcdtceudgyqte.supabase.co';
const SUPABASE_KEY = 'sb_publishable__IUHDdNIhWUfHmOuHarYlA_euCZrYVD';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let dataCabangGlobal = [];
let dataKamarGlobal = [];
let dataPenghuniGlobal = [];
let kamarAktifTerpilih = null;
let penghuniAktifLogin = null;
let totalTagihanTerhitung = 0;

// Helper untuk mencegah serangan Cross-Site Scripting (XSS)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ==========================================
// 2. AUTHENTICATION & LOGIN (UNIVERSAL)
// ==========================================
const LIST_OWNER_BACKUP = [
    { nama: 'Owner 1 (Finance)', pin: '1111' },
    { nama: 'Owner 2 (Operational)', pin: '2222' },
    { nama: 'Owner 3 (Facility)', pin: '3333' },
    { nama: 'Super Admin', pin: '4kkost' }
];

async function handleLoginUniversal(e) {
    e.preventDefault();
    const email = document.getElementById('inputEmail').value.trim();
    const password = document.getElementById('inputPassword').value;
    const btn = document.getElementById('btnSubmitLogin');

    btn.disabled = true;
    btn.innerText = 'Memverifikasi Akun...';

    try {
        // Cek Fallback PIN Cepat jika memasukkan kode Super Admin / PIN khusus
        const backupOwner = LIST_OWNER_BACKUP.find(o => o.pin === password || o.pin === email);
        if (backupOwner) {
            sessionStorage.setItem('userRole', 'owner');
            sessionStorage.setItem('ownerName', backupOwner.nama);
            window.location.href = 'owner-dashboard.html';
            return;
        }

        // Login resmi ke Supabase Auth
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Ambil data profil pengguna
        const { data: profile, error: profErr } = await supabaseClient
            .from('user_profiles')
            .select('*, penghuni(*)')
            .eq('id', data.user.id)
            .single();

        if (profErr || !profile) {
            await supabaseClient.auth.signOut();
            throw new Error('Data profil pengguna tidak terdaftar di sistem database.');
        }

        if (profile.role === 'owner' || profile.role === 'admin') {
            sessionStorage.setItem('userRole', profile.role);
            sessionStorage.setItem('ownerName', profile.role === 'owner' ? 'Owner Properti' : 'Admin Operasional');
            window.location.href = 'owner-dashboard.html';
        } else if (profile.role === 'penyewa') {
            sessionStorage.setItem('userRole', 'penyewa');
            sessionStorage.setItem('penghuniAktif', JSON.stringify(profile.penghuni));
            window.location.href = 'penyewa-dashboard.html';
        } else {
            throw new Error('Peran akun tidak valid.');
        }
    } catch (err) {
        alert('Gagal Masuk: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = '🔑 Masuk ke Akun';
    }
}

function logoutUser() {
    if (supabaseClient) supabaseClient.auth.signOut();
    sessionStorage.clear();
    window.location.href = 'index.html';
}

// ==========================================
// 3. KELOLA CABANG DINAMIS (OWNER)
// ==========================================
async function muatCabangDinamis() {
    const { data } = await supabaseClient.from('cabang').select('*').order('nama_cabang');
    dataCabangGlobal = data || [];

    const statCabang = document.getElementById('statTotalCabang');
    if (statCabang) statCabang.innerText = `${dataCabangGlobal.length} Cabang`;

    // Tombol Filter Cabang
    const containerFilter = document.getElementById('containerFilterCabang');
    if (containerFilter) {
        let htmlButtons = `<button type="button" onclick="filterCabang('Semua')" class="btn-filter bg-orange-600 text-white px-3 py-2 rounded-xl font-bold transition">Semua</button>`;
        dataCabangGlobal.forEach(c => {
            htmlButtons += `<button type="button" onclick="filterCabang('${esc(c.nama_cabang)}')" class="btn-filter bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl font-semibold transition">${esc(c.nama_cabang)}</button>`;
        });
        containerFilter.innerHTML = htmlButtons;
    }

    // Pilihan Dropdown Modal Registrasi
    const selectCabang = document.getElementById('inputCabang');
    if (selectCabang) {
        selectCabang.innerHTML = dataCabangGlobal.map(c => `<option value="${esc(c.nama_cabang)}">${esc(c.nama_cabang)}</option>`).join('');
    }

    // Daftar Cabang di Modal Kelola Cabang
    const containerModal = document.getElementById('containerDaftarCabangModal');
    if (containerModal) {
        containerModal.innerHTML = dataCabangGlobal.map(c => `
            <div class="flex justify-between items-center p-2.5 border rounded-xl bg-slate-50 text-xs">
                <span class="font-bold text-slate-800">${esc(c.nama_cabang)}</span>
                <button type="button" onclick="hapusCabang(${c.id}, '${esc(c.nama_cabang)}')" class="text-rose-600 font-bold hover:underline text-[11px]">Hapus</button>
            </div>
        `).join('');
    }
}

function bukaModalKelolaCabang() { document.getElementById('modalKelolaCabang').classList.remove('hidden'); }
function tutupModalKelolaCabang() { document.getElementById('modalKelolaCabang').classList.add('hidden'); }

async function tambahCabangBaru(e) {
    e.preventDefault();
    const nama = document.getElementById('inputNamaCabangBaru').value.trim();
    if (!nama) return;

    const { error } = await supabaseClient.from('cabang').insert([{ nama_cabang: nama }]);
    if (error) {
        alert('Gagal menambah cabang: ' + error.message);
    } else {
        document.getElementById('inputNamaCabangBaru').value = '';
        await muatCabangDinamis();
        renderTabelKamarPerUnit();
    }
}

async function hapusCabang(id, nama) {
    if (!confirm(`Hapus cabang "${nama}"? Semua data kamar di cabang ini juga akan terhapus!`)) return;
    await supabaseClient.from('cabang').delete().eq('id', id);
    await muatCabangDinamis();
    renderTabelKamarPerUnit();
}

// ==========================================
// 4. MONITORING KAMAR & UNIT (ROOM-CENTRIC)
// ==========================================
async function renderTabelKamarPerUnit(filterCabangTarget = 'Semua') {
    const tbody = document.getElementById('tabelBodyKamar');
    if (!tbody) return;

    try {
        const { data: listKamar } = await supabaseClient.from('kamar').select('*').order('nomor_kamar');
        const { data: listPenghuni } = await supabaseClient.from('penghuni').select('*');
        const { data: listInventaris } = await supabaseClient.from('inventaris_kamar').select('*');

        dataKamarGlobal = listKamar || [];
        dataPenghuniGlobal = listPenghuni || [];

        // Perbarui Statistik Ringkasan
        const totalPenghuni = dataPenghuniGlobal.length;
        const totalTunggakan = dataPenghuniGlobal.filter(p => p.status_bayar !== 'Sudah Bayar').length;
        
        const elOkupansi = document.getElementById('statOkupansi');
        const elKamarKosong = document.getElementById('statKamarKosong');
        const elTunggakan = document.getElementById('statTunggakan');

        if (elOkupansi) elOkupansi.innerText = `${totalPenghuni} Penghuni`;
        if (elKamarKosong) elKamarKosong.innerText = `${dataKamarGlobal.length} Kamar Terdaftar`;
        if (elTunggakan) elTunggakan.innerText = `${totalTunggakan} Tagihan`;

        let kamarTampil = dataKamarGlobal;
        if (filterCabangTarget !== 'Semua') {
            kamarTampil = dataKamarGlobal.filter(k => k.cabang && k.cabang.toLowerCase().trim() === filterCabangTarget.toLowerCase().trim());
        }

        if (kamarTampil.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Belum ada unit kamar terdaftar. Klik "+ Registrasi Penghuni Baru" untuk mulai.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        kamarTampil.forEach(k => {
            const matchKamar = (p) => {
                const noP = (p.nomor_kamar || p.kamar || '').toString().toLowerCase().trim();
                const noK = (k.nomor_kamar || '').toString().toLowerCase().trim();
                const cabP = (p.cabang || '').toString().toLowerCase().trim();
                const cabK = (k.cabang || '').toString().toLowerCase().trim();
                return noP === noK && cabP === cabK;
            };

            const p1 = dataPenghuniGlobal.find(p => matchKamar(p) && (p.posisi_penghuni === 1 || !p.posisi_penghuni));
            const p2 = dataPenghuniGlobal.find(p => matchKamar(p) && p.posisi_penghuni === 2);
            const invKamar = (listInventaris || []).filter(inv => 
                (inv.nomor_kamar || '').toString().toLowerCase().trim() === (k.nomor_kamar || '').toString().toLowerCase().trim() &&
                (inv.cabang || '').toString().toLowerCase().trim() === (k.cabang || '').toString().toLowerCase().trim()
            );

            let uiP1 = p1 
                ? `<div class="font-bold text-slate-800">${esc(p1.nama)} <button type="button" onclick="bukaModalDetail(${p1.id})" class="text-[10px] text-orange-600 hover:underline font-semibold">(Detail)</button></div>`
                : '<span class="text-slate-400 italic">Kosong</span>';

            let uiP2 = p2 
                ? `<div class="font-bold text-slate-800">${esc(p2.nama)} <button type="button" onclick="bukaModalDetail(${p2.id})" class="text-[10px] text-orange-600 hover:underline font-semibold">(Detail)</button></div>`
                : '<span class="text-slate-400 italic">-</span>';

            const badgeStatus = (p) => {
                if (!p) return '';
                let warna = 'bg-rose-100 text-rose-700';
                if (p.status_bayar === 'Sudah Bayar') warna = 'bg-emerald-100 text-emerald-800';
                if (p.status_bayar === 'Menunggu Verifikasi') warna = 'bg-amber-100 text-amber-800';
                return `<button type="button" onclick="ubahStatusBayar(${p.id}, '${p.status_bayar === 'Sudah Bayar' ? 'Belum Bayar' : 'Sudah Bayar'}')" class="${warna} px-2 py-0.5 rounded-full font-bold text-[10px] block my-0.5">P${p.posisi_penghuni || 1}: ${p.status_bayar}</button>`;
            };

            const pTargetEdit = p1 || p2;

            tbody.innerHTML += `
                <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                    <td class="p-3 font-extrabold text-orange-600">${esc(k.nomor_kamar)}</td>
                    <td class="p-3 text-slate-500 font-medium">${esc(k.cabang)}</td>
                    <td class="p-3">${uiP1}</td>
                    <td class="p-3">${uiP2}</td>
                    <td class="p-3">${(p1 || p2) ? badgeStatus(p1) + badgeStatus(p2) : '-'}</td>
                    <td class="p-3 text-center">
                        <button type="button" onclick="bukaModalInventaris('${esc(k.nomor_kamar)}', '${esc(k.cabang)}')" class="bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold px-3 py-1 rounded-xl text-xs transition border border-orange-200">
                            📦 Fasilitas (${invKamar.length})
                        </button>
                    </td>
                    <td class="p-3 text-center">
                        ${pTargetEdit ? `<button type="button" onclick="bukaModalEditAdmin(${pTargetEdit.id})" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg font-bold text-[11px] transition">Edit Data</button>` : '-'}
                    </td>
                </tr>
            `;
        });
    } catch (err) {
        console.error("Error render tabel:", err);
    }
}

function filterCabang(namaCabang) {
    const tombolList = document.querySelectorAll('#containerFilterCabang .btn-filter');
    tombolList.forEach(btn => {
        const isMatch = btn.innerText.trim() === namaCabang;
        btn.className = isMatch
            ? 'btn-filter bg-orange-600 text-white px-3 py-2 rounded-xl font-bold transition'
            : 'btn-filter bg-slate-100 text-slate-700 px-3 py-2 rounded-xl font-semibold transition';
    });
    renderTabelKamarPerUnit(namaCabang);
}

// ==========================================
// 5. REGISTRASI PENGHUNI BARU
// ==========================================
function bukaModalTambahPenghuni() { document.getElementById('modalTambahPenghuni').classList.remove('hidden'); }
function tutupModalTambahPenghuni() { document.getElementById('modalTambahPenghuni').classList.add('hidden'); }

async function simpanPenghuniBaru(e) {
    e.preventDefault();

    const kamarInput = document.getElementById('inputKamar').value.trim();
    const cabangInput = document.getElementById('inputCabang').value;
    const posisiPenghuni = parseInt(document.getElementById('inputPosisiPenghuni').value);

    // Validasi Slot
    const { data: listP } = await supabaseClient.from('penghuni').select('*');
    if (listP) {
        const terisi = listP.find(p => {
            const noKamarP = (p.nomor_kamar || p.kamar || '').toString().toLowerCase().trim();
            const cabangP = (p.cabang || '').toString().toLowerCase().trim();
            const posP = p.posisi_penghuni || 1;
            return noKamarP === kamarInput.toLowerCase() && cabangP === cabangInput.toLowerCase() && posP === posisiPenghuni;
        });

        if (terisi) {
            alert(`⚠️ SLOT KAMAR SUDAH TERISI!\n\nKamar ${kamarInput} (${cabangInput}) untuk Penghuni ${posisiPenghuni === 1 ? 'I' : 'II'} sudah ditempati oleh "${terisi.nama}".`);
            return;
        }
    }

    // Pastikan master kamar tercatat
    await supabaseClient.from('kamar').upsert([{ nomor_kamar: kamarInput, cabang: cabangInput }], { onConflict: 'nomor_kamar, cabang' });

    const newPenghuni = {
        nama: document.getElementById('inputNama').value,
        nik: document.getElementById('inputNIK').value,
        no_hp: document.getElementById('inputNoHp').value,
        posisi_penghuni: posisiPenghuni,
        cabang: cabangInput,
        nomor_kamar: kamarInput,
        kamar: kamarInput,
        gender: 'L',
        tgl_lahir: document.getElementById('inputTglLahir').value,
        tgl_masuk: document.getElementById('inputTglMasuk').value,
        jenis_kendaraan: document.getElementById('inputKendaraan').value,
        plat_nomor: document.getElementById('inputPlat').value || '-',
        durasi_sewa: 1,
        status_bayar: 'Belum Bayar',
        tarif_dasar: parseInt(document.getElementById('inputTarif').value)
    };

    const { error } = await supabaseClient.from('penghuni').insert([newPenghuni]);

    if (error) {
        alert('Gagal registrasi: ' + error.message);
    } else {
        alert(`Berhasil! "${newPenghuni.nama}" telah terdaftar di Kamar ${kamarInput}.`);
        tutupModalTambahPenghuni();
        renderTabelKamarPerUnit();
    }
}

// ==========================================
// 6. DETAIL PENGHUNI & AKSI CEPAT ADMIN
// ==========================================
function bukaModalDetail(idPenghuni) {
    const p = dataPenghuniGlobal.find(item => item.id === idPenghuni);
    if (!p) return;

    const container = document.getElementById('isiDetailPenghuni');
    const btnWA = document.getElementById('btnKirimWA');
    const btnHapus = document.getElementById('btnHapusPenghuni');

    const statusBayarText = p.status_bayar === 'Sudah Bayar' ? '✓ Lunas' : '⏳ Belum Bayar';
    const statusBayarColor = p.status_bayar === 'Sudah Bayar' ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold';

    if (container) {
        container.innerHTML = `
            <div class="bg-slate-50 p-3 rounded-2xl space-y-2 border border-slate-200 text-xs">
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-semibold text-[10px]">NAMA</span><span class="font-bold text-slate-800">${esc(p.nama)} (${p.posisi_penghuni === 2 ? 'Penghuni II' : 'Penghuni I'})</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-semibold text-[10px]">NIK</span><span class="font-mono text-slate-700">${esc(p.nik || '-')}</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-semibold text-[10px]">NO WA</span><span class="font-mono font-bold text-slate-800">${esc(p.no_hp || '-')}</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-semibold text-[10px]">KAMAR & CABANG</span><span class="font-bold text-orange-600">${esc(p.nomor_kamar || p.kamar)} (${esc(p.cabang)})</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-semibold text-[10px]">STATUS BAYAR</span><span class="${statusBayarColor}">${statusBayarText}</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-semibold text-[10px]">KENDARAAN</span><span class="font-semibold text-slate-800">${esc(p.jenis_kendaraan || 'Tidak ada')} (${esc(p.plat_nomor || '-')})</span></div>
            </div>
            <div class="bg-orange-50 p-3 rounded-2xl space-y-1 border border-orange-100 text-xs">
                <div class="flex justify-between font-bold text-orange-950"><span>Tarif Sewa:</span> <span>Rp ${(p.tarif_dasar || 0).toLocaleString('id-ID')}</span></div>
            </div>
        `;
    }

    if (btnWA) {
        btnWA.onclick = () => {
            const noHp = (p.no_hp || '').replace(/^0/, '62').replace(/\D/g, '');
            const pesan = `Halo Sdr/i *${p.nama}*,\n\nBerikut ringkasan tagihan sewa *Kamar ${p.nomor_kamar || p.kamar} (${p.cabang})*:\n*Total Tagihan: Rp ${(p.tarif_dasar || 0).toLocaleString('id-ID')}*\nStatus: ${statusBayarText}\n\nSilakan lakukan pembayaran melalui portal penyewa. Terima kasih!`;
            window.open(`https://wa.me/${noHp}?text=${encodeURIComponent(pesan)}`, '_blank');
        };
    }

    if (btnHapus) {
        btnHapus.onclick = () => hapusPenghuni(p.id, p.nama, p.nomor_kamar || p.kamar);
    }

    document.getElementById('modalDetailPenghuni').classList.remove('hidden');
}

function tutupModalDetail() { document.getElementById('modalDetailPenghuni').classList.add('hidden'); }

async function hapusPenghuni(id, nama, nomorKamar) {
    if (!confirm(`Keluarkan/Hapus data penghuni "${nama}" dari Kamar ${nomorKamar}?`)) return;
    await supabaseClient.from('penghuni').delete().eq('id', id);
    alert(`Penghuni ${nama} berhasil dihapus.`);
    tutupModalDetail();
    renderTabelKamarPerUnit();
}

async function ubahStatusBayar(id, statusBaru) {
    if (!confirm(`Ubah status pembayaran menjadi "${statusBaru}"?`)) return;
    await supabaseClient.from('penghuni').update({ status_bayar: statusBaru }).eq('id', id);
    renderTabelKamarPerUnit();
}

function bukaModalEditAdmin(idPenghuni) {
    const p = dataPenghuniGlobal.find(item => item.id === idPenghuni);
    if (!p) return;

    document.getElementById('editPenghuniId').value = p.id;
    document.getElementById('editNama').value = p.nama || '';
    document.getElementById('editNoHp').value = p.no_hp || '';
    document.getElementById('editTarif').value = p.tarif_dasar || 0;
    document.getElementById('editStatusBayar').value = p.status_bayar || 'Belum Bayar';

    document.getElementById('modalEditAdmin').classList.remove('hidden');
}

function tutupModalEditAdmin() { document.getElementById('modalEditAdmin').classList.add('hidden'); }

async function simpanPerubahanAdmin(e) {
    e.preventDefault();
    const id = document.getElementById('editPenghuniId').value;
    const updateData = {
        nama: document.getElementById('editNama').value.trim(),
        no_hp: document.getElementById('editNoHp').value.trim(),
        tarif_dasar: parseInt(document.getElementById('editTarif').value),
        status_bayar: document.getElementById('editStatusBayar').value
    };

    const { error } = await supabaseClient.from('penghuni').update(updateData).eq('id', id);
    if (error) {
        alert('Gagal memperbarui data: ' + error.message);
    } else {
        alert('Data penghuni berhasil diperbarui.');
        tutupModalEditAdmin();
        renderTabelKamarPerUnit();
    }
}

// ==========================================
// 7. INVENTARIS FASILITAS KAMAR
// ==========================================
async function bukaModalInventaris(nomorKamar, cabang) {
    kamarAktifTerpilih = { nomorKamar, cabang };
    document.getElementById('labelModalKamar').innerText = `Unit: ${nomorKamar} (${cabang})`;
    await muatListInventarisUI(nomorKamar, cabang);
    document.getElementById('modalInventarisKamar').classList.remove('hidden');
}

function tutupModalInventaris() { document.getElementById('modalInventarisKamar').classList.add('hidden'); }

async function muatListInventarisUI(nomorKamar, cabang) {
    const container = document.getElementById('containerListInventaris');
    if (!container) return;

    const { data: listBarang } = await supabaseClient.from('inventaris_kamar').select('*')
        .eq('nomor_kamar', nomorKamar).eq('cabang', cabang);

    if (!listBarang || listBarang.length === 0) {
        container.innerHTML = `<p class="text-slate-400 italic text-center py-2 text-xs">Belum ada fasilitas terdaftar.</p>`;
        return;
    }

    container.innerHTML = listBarang.map(b => `
        <div class="flex justify-between items-center p-2.5 border rounded-xl bg-slate-50 text-xs">
            <div>
                <span class="font-bold text-slate-800">${esc(b.nama_barang)}</span>
                <span class="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-800 ml-2">${esc(b.kondisi)}</span>
            </div>
            <button type="button" onclick="hapusInventaris(${b.id})" class="text-rose-500 font-bold px-2 py-1 text-[10px]">Hapus</button>
        </div>
    `).join('');
}

async function tambahInventarisBaru(e) {
    e.preventDefault();
    if (!kamarAktifTerpilih) return;

    const namaBarang = document.getElementById('inputNamaBarang').value.trim();
    const kondisi = document.getElementById('inputKondisiBarang').value;

    await supabaseClient.from('inventaris_kamar').insert([{
        nomor_kamar: kamarAktifTerpilih.nomorKamar,
        cabang: kamarAktifTerpilih.cabang,
        nama_barang: namaBarang,
        kondisi: kondisi
    }]);

    document.getElementById('inputNamaBarang').value = '';
    await muatListInventarisUI(kamarAktifTerpilih.nomorKamar, kamarAktifTerpilih.cabang);
    renderTabelKamarPerUnit();
}

async function hapusInventaris(id) {
    if (!confirm('Hapus item fasilitas ini?')) return;
    await supabaseClient.from('inventaris_kamar').delete().eq('id', id);
    await muatListInventarisUI(kamarAktifTerpilih.nomorKamar, kamarAktifTerpilih.cabang);
    renderTabelKamarPerUnit();
}

// ==========================================
// 8. TIKET MAINTENANCE & PERBAIKAN
// ==========================================
async function renderTabelMaintenance() {
    const tbody = document.getElementById('tabelBodyMaintenance');
    if (!tbody) return;

    const { data: listKomplain } = await supabaseClient.from('maintenance').select('*').order('created_at', { ascending: false });
    const tiketAktif = (listKomplain || []).filter(k => k.status !== 'Done');

    const badgeKomplain = document.getElementById('badgeTotalKomplain');
    const statTotalM = document.getElementById('statMaintenanceTotal');
    const statDetailM = document.getElementById('statMaintenanceDetail');

    if (badgeKomplain) badgeKomplain.innerText = `${tiketAktif.length} Tiket Aktif`;
    if (statTotalM) statTotalM.innerText = `${tiketAktif.length} Komplain`;
    if (statDetailM) statDetailM.innerText = tiketAktif.length > 0 ? 'Perlu Perbaikan' : 'Sistem Normal';

    if (!listKomplain || listKomplain.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Tidak ada komplain aktif saat ini.</td></tr>`;
        return;
    }

    tbody.innerHTML = listKomplain.map(k => `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
            <td class="p-3 text-slate-500">${new Date(k.created_at || Date.now()).toLocaleDateString('id-ID')}</td>
            <td class="p-3 font-semibold text-slate-800">${esc(k.nama_penghuni || '-')}</td>
            <td class="p-3 font-bold text-orange-600">${esc(k.kamar || '-')} (${esc(k.cabang || '-')})</td>
            <td class="p-3 text-slate-700">${esc(k.deskripsi)}</td>
            <td class="p-3">${k.status === 'Done' ? '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[10px] font-bold">Done</span>' : '<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-[10px] font-bold">Open</span>'}</td>
            <td class="p-3 text-center">${k.status === 'Done' ? '-' : `<button type="button" onclick="selesaikanKomplain(${k.id})" class="bg-emerald-600 text-white px-2.5 py-1 rounded-lg text-[10px] font-bold transition hover:bg-emerald-700">Selesai</button>`}</td>
        </tr>
    `).join('');
}

async function selesaikanKomplain(id) {
    if (!confirm('Tandai keluhan perbaikan ini sudah selesai ditangani?')) return;
    await supabaseClient.from('maintenance').update({ status: 'Done' }).eq('id', id);
    renderTabelMaintenance();
}

// ==========================================
// 9. LOGIKA KHUSUS PORTAL PENYEWA
// ==========================================
async function inisialisasiPortalPenyewa() {
    const rawData = sessionStorage.getItem('penghuniAktif');
    if (!rawData) {
        alert('Sesi penyewa berakhir, silakan login kembali.');
        window.location.href = 'index.html';
        return;
    }

    penghuniAktifLogin = JSON.parse(rawData);

    // Ambil data terbaru langsung dari database Supabase
    const { data: pDb } = await supabaseClient.from('penghuni').select('*').eq('id', penghuniAktifLogin.id).single();
    if (pDb) penghuniAktifLogin = pDb;

    // Tampilkan Nama & Detail Unit
    const elNama = document.getElementById('penyewaNama');
    const elDetail = document.getElementById('penyewaDetailKamar');
    if (elNama) elNama.innerText = penghuniAktifLogin.nama;
    if (elDetail) elDetail.innerText = `Kamar ${penghuniAktifLogin.nomor_kamar || penghuniAktifLogin.kamar} • ${penghuniAktifLogin.cabang}`;

    // Cek Voucher Ulang Tahun Berdasarkan Bulan Ini
    let potonganVoucher = 0;
    if (penghuniAktifLogin.tgl_lahir) {
        const bulanLahir = new Date(penghuniAktifLogin.tgl_lahir).getMonth();
        const bulanSekarang = new Date().getMonth();
        if (bulanLahir === bulanSekarang) {
            potonganVoucher = 20000;
            const banner = document.getElementById('bannerUltah');
            if (banner) banner.classList.remove('hidden');
        }
    }

    // Hitung Tagihan
    const tarifDasar = penghuniAktifLogin.tarif_dasar || 0;
    totalTagihanTerhitung = Math.max(0, tarifDasar - potonganVoucher);

    const elTarif = document.getElementById('penyewaTarif');
    const elVoucher = document.getElementById('penyewaVoucher');
    const elTotal = document.getElementById('penyewaTotalTagihan');
    const elQrisTotal = document.getElementById('qrisTotalBayar');

    if (elTarif) elTarif.innerText = `Rp ${tarifDasar.toLocaleString('id-ID')}`;
    if (elVoucher) elVoucher.innerText = `- Rp ${potonganVoucher.toLocaleString('id-ID')}`;
    if (elTotal) elTotal.innerText = `Rp ${totalTagihanTerhitung.toLocaleString('id-ID')}`;
    if (elQrisTotal) elQrisTotal.innerText = `Rp ${totalTagihanTerhitung.toLocaleString('id-ID')}`;
}

function bukaModalQRIS() {
    const modal = document.getElementById('modalQRIS');
    if (modal) modal.classList.add('aktif');
}

function tutupModalQRIS() {
    const modal = document.getElementById('modalQRIS');
    if (modal) modal.classList.remove('aktif');
}

async function prosesPembayaran(e) {
    e.preventDefault();
    if (!penghuniAktifLogin) return;

    // Ubah status bayar menjadi Menunggu Verifikasi
    const { error } = await supabaseClient
        .from('penghuni')
        .update({ status_bayar: 'Menunggu Verifikasi' })
        .eq('id', penghuniAktifLogin.id);

    if (error) {
        alert('Gagal mengirim konfirmasi: ' + error.message);
    } else {
        alert('Bukti pembayaran berhasil dikirim! Menunggu konfirmasi verifikasi dari pihak pengelola/owner.');
        tutupModalQRIS();
        location.reload();
    }
}

async function laporKerusakan() {
    if (!penghuniAktifLogin) return;
    const keluhan = prompt('Tuliskan rincian kerusakan fasilitas pada kamar Anda:');
    if (!keluhan || !keluhan.trim()) return;

    const tiketBaru = {
        nama_penghuni: penghuniAktifLogin.nama,
        kamar: penghuniAktifLogin.nomor_kamar || penghuniAktifLogin.kamar,
        cabang: penghuniAktifLogin.cabang,
        deskripsi: keluhan.trim(),
        status: 'Open'
    };

    const { error } = await supabaseClient.from('maintenance').insert([tiketBaru]);
    if (error) {
        alert('Gagal mengirim laporan: ' + error.message);
    } else {
        alert('Laporan kerusakan berhasil diteruskan ke tim pengelola.');
    }
}

// ==========================================
// 10. EVENT LISTENER OTOMATIS BERDASARKAN HALAMAN
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const pageOwner = document.querySelector('body[data-page="owner"]');
    const isPenyewaPage = document.getElementById('penyewaNama') !== null;

    if (pageOwner) {
        const activeOwner = sessionStorage.getItem('ownerName') || 'Owner Properti';
        const labelOwner = document.getElementById('labelOwnerName');
        if (labelOwner) labelOwner.innerText = '👤 ' + activeOwner;

        await muatCabangDinamis();
        await renderTabelKamarPerUnit();
        await renderTabelMaintenance();
    } else if (isPenyewaPage) {
        await inisialisasiPortalPenyewa();
    }
});