// ==========================================
// KONFIGURASI API (GANTI INI DENGAN URL & PIN KAMU!)
// ==========================================
const API_URL = "https://script.google.com/macros/s/AKfycbwJTyaGB4CCa9LVOa6nhHeGoZy5noRlGJhV8Q3VBzq5tYUNNpagP8MP8Sg_MLfyS8NY3w/exec";
const API_PIN = "RAHASIA123"; // Harus sama dengan yang di Kode.gs

const $ = id => document.getElementById(id);
let allData = { vendors: [], transaksi: [], arsip: [] };

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    $('loadingIndicator').style.display = 'block';
    
    fetch(`${API_URL}?action=getInitialData&pin=${API_PIN}`)
        .then(res => res.json())
        .then(res => {
            if(!res.success) throw new Error(res.message);
            
            allData = res.data;
            $('sheetLink').href = allData.spreadsheetUrl; 
            $('driveLink').href = allData.driveUrl;
            
            const vendorSelect = $('vendor');
            vendorSelect.innerHTML = '<option value="">-- Pilih Vendor --</option>';
            allData.vendors.forEach(v => vendorSelect.innerHTML += `<option value="${v.nama}">${v.nama}</option>`);

            $('loadingIndicator').style.display = 'none';
            $('tab-arsip').style.display = 'block';

            renderArsipTable();
            renderLaporanVendor();
            pasangEvent();
        })
        .catch(err => {
            $('loadingIndicator').innerHTML = `<span style="color:red; font-weight:bold;">Gagal terhubung ke Server: ${err.message}</span>`;
        });
}

function pasangEvent() {
    $('uploadForm').addEventListener('submit', handleUploadTransaksi);
    $('uploadFormLepas').addEventListener('submit', handleUploadLepas);
    $('vendorForm').addEventListener('submit', handleSaveVendor);
    $('addDocBtn').addEventListener('click', addDocRow);
    $('searchArsip').addEventListener('input', renderArsipTable);
    $('searchInput').addEventListener('input', renderLaporanVendor);
}

function switchTab(tabId, el) {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
    $(`tab-${tabId}`).style.display = 'block';
    el.classList.add('active');
    $('pageTitle').textContent = el.innerText.trim().replace(/[^\w\s]/gi, '').trim();
}

// ==================== HELPER API ====================
// ==================== HELPER API ====================
async function callAPI(action, payload = {}) {
    // Trik: Gunakan URLSearchParams agar Google menganggap ini request form biasa (Bypass CORS)
    const formData = new URLSearchParams();
    formData.append('action', action);
    formData.append('pin', API_PIN);
    formData.append('payload', JSON.stringify(payload));

    const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    
    const res = await response.json();
    if (!res.success) throw new Error(res.message);
    return res.data;
}

function fileToBase64(file){
    return new Promise((resolve,reject)=>{
        const r = new FileReader(); 
        r.onload = () => resolve(String(r.result)); 
        r.onerror = reject; 
        r.readAsDataURL(file);
    });
}

// ==================== FUNGSI UI ====================
function renderArsipTable() {
    const keyword = $('searchArsip').value.toLowerCase().trim();
    const rows = allData.arsip.filter(a => [a.nama, a.vendor, a.namaFile, a.kategori].join(' ').toLowerCase().includes(keyword));

    $('statTotalDok').textContent = allData.arsip.length;
    $('statLegal').textContent = allData.arsip.filter(a => a.kategori === 'LEGALITAS PERUSAHAAN').length;
    $('statTrx').textContent = allData.arsip.filter(a => a.kategori === 'TRANSAKSI BBM').length;
    $('statKeu').textContent = allData.arsip.filter(a => a.kategori === 'KEUANGAN').length;

    if(rows.length === 0) {
        $('arsipRows').innerHTML = '<tr><td colspan="6" class="empty">Tidak ada dokumen.</td></tr>';
        return;
    }

    $('arsipRows').innerHTML = rows.map((a, i) => `
        <tr>
        <td>${i + 1}</td>
        <td>${new Date(a.tanggal).toLocaleDateString('id-ID')}</td>
        <td><span class="status ${a.kategori === 'TRANSAKSI BBM' ? 'Lengkap' : 'Kurang'}">${esc(a.kategori)}</span></td>
        <td><strong>${esc(a.nama)}</strong></td>
        <td>${esc(a.vendor)}</td>
        <td><a href="${a.link}" target="_blank" class="file-link">Preview ↗</a></td>
        </tr>
    `).join('');
}

function addDocRow() {
    const div = document.createElement('div');
    div.className = 'dokumen-row form-grid';
    div.style.gridTemplateColumns = '1fr 2fr'; div.style.marginBottom = '10px';
    div.innerHTML = `
        <label>Jenis<select class="doc-type"><option>Invoice</option><option>PO</option><option>Surat Jalan</option><option>BAST</option></select></label>
        <div style="display:flex; gap:10px; align-items:end;">
        <label style="flex:1">File<input type="file" class="doc-file" accept="application/pdf"></label>
        <button type="button" class="button secondary" style="background:#fee2e2; color:#b91c1c;" onclick="this.parentElement.parentElement.remove()">X</button>
        </div>`;
    $('dokumenContainer').appendChild(div);
}

// ==================== SUBMIT ====================
async function handleUploadLepas(e) {
    e.preventDefault();
    const files = $('docFileLepas').files;
    if(files.length === 0) return;
    
    setBusy('btnUploadLepas', true, 'Mengunggah...');
    const filesPayload = [];
    for (const file of files) {
        filesPayload.push({ name: file.name, mimeType: file.type, size: (file.size/1024).toFixed(0)+' KB', base64: await fileToBase64(file) });
    }

    try {
        const res = await callAPI('uploadDokumenLepas', { kategori: $('docKategori').value, namaDok: $('docNama').value.trim(), files: filesPayload });
        $('msgLepas').textContent = res.message; $('msgLepas').style.color = '#166534';
        $('uploadFormLepas').reset(); 
        initApp();
    } catch (err) {
        $('msgLepas').textContent = err.message; $('msgLepas').style.color = '#991b1b';
    }
    setBusy('btnUploadLepas', false, 'Upload ke Arsip');
}

async function handleSaveVendor(e) {
    e.preventDefault();
    setBusy('v_submitBtn', true, 'Menyimpan…');
    try {
        const fileIzin = $('v_file').files[0];
        const payload = {
            nama: $('v_nama').value.trim(), tglMulai: $('v_mulai').value, tglAkhir: $('v_akhir').value,
            fileIzin: fileIzin ? await fileToBase64(fileIzin) : null
        };
        const res = await callAPI('saveVendor', payload);
        $('vendorMessage').textContent = res.message; $('vendorMessage').style.color = '#166534';
        $('vendorForm').reset();
        initApp();
    } catch (err) {
        $('vendorMessage').textContent = err.message; $('vendorMessage').style.color = '#991b1b'; 
    }
    setBusy('v_submitBtn', false, 'Simpan Vendor');
}

async function handleUploadTransaksi(e) {
    e.preventDefault();
    setBusy('submitBtn', true, 'Memproses...'); 
    try {
        const docRows = document.querySelectorAll('.dokumen-row');
        const filesPayload = [];
        for (const row of docRows) {
            const file = row.querySelector('.doc-file').files[0];
            if (file) filesPayload.push({ jenis: row.querySelector('.doc-type').value, name: file.name, base64: await fileToBase64(file) });
        }
        const payload = {
            tglInvoice: $('tglInvoice').value, vendor: $('vendor').value, 
            noInv: $('noInv').value.trim(), noPO: $('noPO').value.trim(),
            volume: $('volume').value, total: $('total').value, 
            statusBayar: $('statusBayar').value, statusDok: $('statusDok').value, files: filesPayload
        };
        
        const res = await callAPI('saveTransaksiDanDokumen', payload);
        alert(res.message); 
        $('uploadForm').reset();
        initApp();
    } catch(err) { 
        alert(err.message); 
    }
    setBusy('submitBtn', false, 'Simpan Transaksi');
}

// ==================== LAPORAN ====================
function formatRupiah(angka) {
    if (!angka) return '0';
    let number_string = angka.toString().replace(/[^,\d]/g, '').toString(),
    split = number_string.split(','), sisa = split[0].length % 3,
    rupiah = split[0].substr(0, sisa), ribuan = split[0].substr(sisa).match(/\d{3}/gi);
    if (ribuan) { let separator = sisa ? '.' : ''; rupiah += separator + ribuan.join('.'); }
    rupiah = split[1] != undefined ? rupiah + ',' + split[1] : rupiah;
    return rupiah;
}

function renderLaporanVendor() {
    const { vendors, transaksi } = allData;
    const keyword = $('searchInput').value.toLowerCase().trim();
    
    let filteredVendors = vendors.filter(v => v.nama.toLowerCase().includes(keyword));
    filteredVendors = filteredVendors.filter(v => transaksi.filter(t => t.vendor === v.nama).length > 0);
    
    if (keyword) {
        filteredVendors = filteredVendors.filter(v => transaksi.filter(t => t.vendor === v.nama && t.tglBlnThn.toLowerCase().includes(keyword)).length > 0);
    }

    if(!filteredVendors.length) {
        $('vendorRows').innerHTML = '<tr><td colspan="6" class="empty">Belum ada transaksi.</td></tr>'; return;
    }

    $('vendorRows').innerHTML = filteredVendors.map(v => {
        const trxTampil = keyword ? transaksi.filter(t => t.vendor === v.nama && t.tglBlnThn.toLowerCase().includes(keyword)) : transaksi.filter(t => t.vendor === v.nama);
        const totalTagihan = trxTampil.reduce((sum, t) => sum + t.total, 0);
        
        const semuaLunas = trxTampil.every(t => t.statusBayar === 'Lunas');
        let badgeBayar = semuaLunas ? '<span class="status Lengkap">Lunas</span>' : '<span class="status Kurang">Belum Lunas</span>';
        const adaDokKurang = trxTampil.some(t => t.statusDok === 'Kurang');
        let badgeDok = adaDokKurang ? '<span class="status Kurang">Kurang</span>' : '<span class="status Lengkap">Lengkap</span>';
        let statusClass = v.status === 'Aktif' ? 'Lengkap' : 'Kurang';

        return `<tr>
            <td><strong>${esc(v.nama)}</strong></td>
            <td><span class="status ${statusClass}">${esc(v.status)}</span></td>
            <td>${trxTampil.length} Trx</td>
            <td>Rp ${formatRupiah(totalTagihan)}</td>
            <td>${badgeBayar}</td>
            <td>${badgeDok}</td>
        </tr>`;
    }).join('');
}

// ==================== UTILS ====================
function setBusy(id,busy,label){$(id).disabled=busy;$(id).textContent=label;}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
