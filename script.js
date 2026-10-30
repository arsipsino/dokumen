// ============================================
// FRONTEND ARSIP DOKUMEN DIGITAL - PT SINO
// ============================================
const API_URL = "https://script.google.com/macros/s/AKfycbwJTyaGB4CCa9LVOa6nhHeGoZy5noRlGJhV8Q3VBzq5tYUNNpagP8MP8Sg_MLfyS8NY3w/exec";
const SESSION_KEY = "pt_sino_session";
let currentUser = null;
const $ = id => document.getElementById(id);
const PAGE_SIZE = 15;
let allData = { vendors: [], transaksi: [], arsip: [], counts: {}, izin: {}, storage: {} };
let filteredDocs = [];
let currentPage = 1;
let selectedDocId = null;
let activeCategory = '';
let activeSubcategory = '';
let appliedFilters = { vendor: '', year: '', month: '', status: '' };
let toastTimer;

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  restoreSession();
});

function setText(id, value) { const el = $(id); if (el) el.textContent = value == null ? '' : String(value); }
function setHref(id, value) { const el = $(id); if (el && el.tagName === 'A') { el.href = value || '#'; el.setAttribute('rel', 'noopener'); } }
function setHidden(id, hidden) { const el = $(id); if (el) el.hidden = !!hidden; }

function getSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; } }
function restoreSession() {
  const session=getSession(); if(!session || !session.token){showLogin();return;}
  currentUser=session.user||null; setHidden('loginScreen',true); setHidden('appShell',false); updateProfile(); initApp();
}
function showLogin(message='') { setHidden('appShell',true); setHidden('loginScreen',false); setText('loginMessage',message); if($('loginPassword')) $('loginPassword').value=''; }
function updateProfile(){const u=currentUser||{};setText('profileName',u.displayName||u.username||'Pengguna');setText('profileRole',u.role==='admin'?'Administrator':'Pengguna');setText('profileAvatar',String(u.displayName||u.username||'U').charAt(0).toUpperCase());setHidden('userAdminPanel',u.role!=='admin');if(u.role==='admin')loadUsers();}
async function handleLogin(e){e.preventDefault();const b=$('loginButton');b.disabled=true;b.textContent='Memeriksa…';setText('loginMessage','');try{const data=await callAPI('login',{username:$('loginUsername').value.trim(),password:$('loginPassword').value});sessionStorage.setItem(SESSION_KEY,JSON.stringify(data));currentUser=data.user;setHidden('loginScreen',true);setHidden('appShell',false);updateProfile();await initApp();}catch(err){setText('loginMessage',err.message||'Login gagal.');}finally{b.disabled=false;b.textContent='Masuk ke Sistem';}}
async function handleLogout(){try{await callAPI('logout');}catch(_){}sessionStorage.removeItem(SESSION_KEY);currentUser=null;showLogin('Anda telah keluar dari sistem.');}
async function handleCreateUser(e){e.preventDefault();const b=$('createUserButton');b.disabled=true;b.textContent='Membuat…';setText('userAdminMessage','');try{const r=await callAPI('adminCreateUser',{username:$('newUsername').value,displayName:$('newDisplayName').value,password:$('newUserPassword').value,role:$('newUserRole').value});$('createUserForm').reset();setText('userAdminMessage',r.message);await loadUsers();}catch(err){setText('userAdminMessage',err.message);}finally{b.disabled=false;b.textContent='＋ Buat Akun';}}
async function loadUsers(){try{const users=await callAPI('adminListUsers');$('userRows').innerHTML=users.map(u=>`<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.displayName)}</td><td>${esc(u.role)}</td><td>${u.active?'Aktif':'Nonaktif'}</td><td>${esc(u.lastLogin||'Belum login')}</td><td><button class="btn btn-outline btn-small" data-user-toggle="${esc(u.username)}" data-active="${u.active?'false':'true'}">${u.active?'Nonaktifkan':'Aktifkan'}</button></td></tr>`).join('')||'<tr><td colspan="6">Belum ada akun.</td></tr>'; $('userRows').querySelectorAll('[data-user-toggle]').forEach(b=>b.addEventListener('click',async()=>{try{await callAPI('adminSetUserStatus',{username:b.dataset.userToggle,active:b.dataset.active==='true',requester:currentUser.username});await loadUsers();}catch(err){setText('userAdminMessage',err.message);}}));}catch(err){setText('userAdminMessage',err.message);}}

async function initApp() {
  setHidden('loadingIndicator', false);
  setHidden('appError', true);
  setText('connectionStatus', 'Menghubungkan…');
  try {
    const data = await callAPI('getInitialData');
    allData = Object.assign({ vendors: [], transaksi: [], arsip: [], counts: {}, izin: {}, storage: {} }, data || {});
    setHidden('loadingIndicator', true);
    setHref('sheetLink', allData.spreadsheetUrl);
    setHref('driveLink', allData.driveUrl);
    setHref('driveLinkSettings', allData.driveUrl);
    populateVendorOptions();
    populateYearOptions();
    renderAll();
    setText('connectionStatus', 'Terhubung');
  } catch (err) {
    setHidden('loadingIndicator', true);
    const message = err && err.message ? err.message : String(err || 'Kesalahan tidak diketahui');
    if (/sesi login/i.test(message)) { sessionStorage.removeItem(SESSION_KEY); currentUser=null; showLogin(message); return; }
    setHidden('appError', false);
    setText('appError', 'Data belum dapat dimuat: ' + message + '. Periksa respons Apps Script dan izin aksesnya.');
    setText('connectionStatus', 'Perlu pemeriksaan');
    console.error('initApp:', err);
  }
}

function bindEvents() {
  const on = (id, event, handler) => { const el = $(id); if (el) el.addEventListener(event, handler); };
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.go)));
  on('mobileMenu', 'click', () => $('sidebar')?.classList.toggle('open'));
  on('searchArsip', 'input', () => { currentPage = 1; renderArsipTable(); });
  on('clearSearch', 'click', () => { if ($('searchArsip')) $('searchArsip').value = ''; currentPage = 1; renderArsipTable(); });
  on('categoryList', 'click', categoryClick);
  on('applyFilter', 'click', applyFilter);
  on('resetFilter', 'click', resetFilter);
  on('selectAll', 'change', e => document.querySelectorAll('.row-check').forEach(c => c.checked = e.target.checked));
  on('exportExcel', 'click', exportArsip);
  on('exportReport', 'click', exportReport);
  on('closePreview', 'click', clearPreview);
  on('openPreview', 'click', () => { const d = selectedDoc(); if (d) window.open(d.previewUrl || d.link, '_blank', 'noopener'); });
  on('versionHistory', 'click', showHistory);
  on('closeHistory', 'click', () => setHidden('historyModal', true));
  on('historyModal', 'click', e => { if (e.target === $('historyModal')) setHidden('historyModal', true); });
  on('addDocBtn', 'click', addDocRow);
  on('uploadForm', 'submit', handleUploadTransaksi);
  on('uploadFormLepas', 'submit', handleUploadLepas);
  on('vendorForm', 'submit', handleSaveVendor);
  on('searchInput', 'input', renderLaporanVendor);
  on('docKategori', 'change', () => setHidden('uploadVendorWrap', $('docKategori').value !== 'VENDOR'));
  on('loginForm', 'submit', handleLogin);
  on('logoutButton', 'click', handleLogout);
  on('createUserForm', 'submit', handleCreateUser);
}


function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.hidden = true);
  const target = $('tab-' + tabId);
  if (target) target.hidden = false;
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  const titles = { dashboard:'Dashboard', vendor:'Master Vendor', izin:'Izin Migas', transaksi:'Transaksi Pembelian', arsip:'Arsip Dokumen Digital', upload:'Upload Dokumen', laporan:'Rekap Laporan', pengaturan:'Pengaturan' };
  $('pageTitle').textContent = titles[tabId] || 'Arsip Dokumen Digital';
  $('sidebar').classList.remove('open');
  if (tabId === 'izin') renderIzin();
  if (tabId === 'vendor') renderVendorMaster();
  if (tabId === 'transaksi') renderTransactions();
  if (tabId === 'laporan') renderLaporanVendor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function callAPI(action, payload = {}) {
  const body = new URLSearchParams();
  body.append('action', action);
  const session = getSession();
  if (action !== 'login' && action !== 'logout') { if (!session || !session.token) throw new Error('Sesi login berakhir. Silakan masuk kembali.'); body.append('token', session.token); }
  if (action === 'logout' && session) body.append('token', session.token);
  body.append('payload', JSON.stringify(payload));
  let response;
  try {
    response = await fetch(API_URL, { method: 'POST', body, redirect: 'follow', cache: 'no-store' });
  } catch (networkError) {
    throw new Error('Tidak dapat menjangkau Web App. Periksa koneksi internet dan deployment Apps Script. ' + networkError.message);
  }
  if (!response.ok) throw new Error('Web App mengembalikan HTTP ' + response.status);
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); }
  catch (_) { throw new Error('Respons Web App bukan JSON. Pastikan URL mengarah ke deployment /exec dan akses Web App diizinkan.'); }
  if (!result || result.success !== true) throw new Error((result && result.message) || 'Permintaan ditolak oleh server.');
  return result.data;
}

function renderAll() {
  renderStats();
  renderArsipTable();
  renderVendorMaster();
  renderIzin();
  renderTransactions();
  renderLaporanVendor();
  renderDashboard();
}

function renderStats() {
  const c = allData.counts || {};
  $('statTotalDok').textContent = c.total ?? allData.arsip.length;
  $('statLegal').textContent = c.legal ?? countCat('LEGALITAS PERUSAHAAN');
  $('statVendor').textContent = c.vendor ?? countCat('VENDOR');
  $('statTrx').textContent = c.transaksi ?? countCat('TRANSAKSI BBM');
  $('statKeu').textContent = c.keuangan ?? countCat('KEUANGAN');
  $('statOps').textContent = c.operasional ?? countCat('OPERASIONAL');
  $('countAll').textContent = allData.arsip.length;
  $('countLegal').textContent = $('statLegal').textContent;
  $('countVendor').textContent = $('statVendor').textContent;
  $('countTrx').textContent = $('statTrx').textContent;
  $('countKeu').textContent = $('statKeu').textContent;
  $('countOps').textContent = $('statOps').textContent;
  $('countPO').textContent = countName('PO');
  $('countInvoice').textContent = countName('Invoice');
  $('countSurat').textContent = countName('Surat Jalan') + countName('BAST');
  $('countBayar').textContent = countName('Bukti Pembayaran');
  $('countPendukung').textContent = countName('Dokumen Pendukung');
  const izin = allData.izin || {};
  $('izinAktif').textContent = $('izinAktif2').textContent = izin.aktif || 0;
  $('izinSegera').textContent = $('izinSegera2').textContent = izin.segera || 0;
  $('izinKedaluwarsa').textContent = $('izinKedaluwarsa2').textContent = izin.kedaluwarsa || 0;
  $('izinNotice').textContent = (izin.segera || 0) + ' vendor akan segera kedaluwarsa dalam 30 hari ke depan.';
  const bytes = (allData.storage || {}).usedBytes || 0;
  const used = formatBytes(bytes);
  $('storageText').textContent = used + ' / kuota akun Drive';
  $('storageBar').style.width = Math.min(100, bytes / (100 * 1024 ** 3) * 100) + '%';
}
function countCat(cat) { return allData.arsip.filter(a => a.kategori === cat).length; }
function countName(name) { return allData.arsip.filter(a => String(a.nama).toLowerCase().includes(name.toLowerCase())).length; }

function categoryClick(e) {
  const sub = e.target.closest('[data-subcategory]');
  const cat = e.target.closest('[data-category]');
  if (sub) {
    activeCategory = 'TRANSAKSI BBM';
    activeSubcategory = sub.dataset.subcategory;
  } else if (cat) {
    activeCategory = cat.dataset.category;
    activeSubcategory = '';
  } else return;
  document.querySelectorAll('.category-item').forEach(b => b.classList.toggle('selected', b.dataset.category === activeCategory));
  document.querySelectorAll('[data-subcategory]').forEach(b => b.classList.toggle('active', b.dataset.subcategory === activeSubcategory));
  currentPage = 1;
  renderArsipTable();
}
function applyFilter() {
  appliedFilters = {
    vendor: $('filterVendor').value,
    year: $('filterTahun').value,
    month: $('filterBulan').value,
    status: $('filterStatus').value
  };
  currentPage = 1;
  renderArsipTable();
}
function resetFilter() {
  ['filterVendor','filterTahun','filterBulan','filterStatus'].forEach(id => $(id).value = '');
  appliedFilters = { vendor:'', year:'', month:'', status:'' };
  activeCategory = ''; activeSubcategory = '';
  document.querySelectorAll('.category-item').forEach(b => b.classList.toggle('selected', b.dataset.category === ''));
  document.querySelectorAll('[data-subcategory]').forEach(b => b.classList.remove('active'));
  $('searchArsip').value = '';
  currentPage = 1;
  renderArsipTable();
}
function populateVendorOptions() {
  const options = allData.vendors.map(v => `<option value="${esc(v.nama)}">${esc(v.nama)}</option>`).join('');
  $('filterVendor').innerHTML = '<option value="">Semua Vendor</option>' + options;
  $('vendor').innerHTML = '<option value="">Pilih Vendor</option>' + options;
  $('uploadVendor').innerHTML = '<option value="">Pilih Vendor</option>' + options;
}
function populateYearOptions() {
  const years = [...new Set(allData.arsip.map(a => (a.tanggalISO || '').slice(0,4)).filter(Boolean))].sort().reverse();
  $('filterTahun').innerHTML = '<option value="">Semua Tahun</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
}

function getFilteredDocs() {
  const q = $('searchArsip').value.toLowerCase().trim();
  return allData.arsip.filter(a => {
    const haystack = [a.nama,a.vendor,a.namaFile,a.kategori,a.idTrx,a.id].join(' ').toLowerCase();
    const date = a.tanggalISO || '';
    const name = String(a.nama || '').toLowerCase();
    const subMatch = !activeSubcategory || name.includes(activeSubcategory.toLowerCase()) ||
      (activeSubcategory === 'Surat Jalan' && name.includes('bast'));
    return (!q || haystack.includes(q)) &&
      (!activeCategory || a.kategori === activeCategory) &&
      subMatch &&
      (!appliedFilters.vendor || a.vendor === appliedFilters.vendor) &&
      (!appliedFilters.year || date.slice(0,4) === appliedFilters.year) &&
      (!appliedFilters.month || date.slice(5,7) === appliedFilters.month) &&
      (!appliedFilters.status || (a.status || 'Lengkap') === appliedFilters.status);
  });
}
function renderArsipTable() {
  filteredDocs = getFilteredDocs();
  const pages = Math.max(1, Math.ceil(filteredDocs.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredDocs.slice(start, start + PAGE_SIZE);
  $('showingCount').textContent = `Menampilkan ${filteredDocs.length ? start + 1 : 0}–${Math.min(start + PAGE_SIZE, filteredDocs.length)} dari ${filteredDocs.length} dokumen`;
  $('pageInfo').textContent = `Halaman ${currentPage} dari ${pages}`;
  if (!pageItems.length) {
    $('arsipRows').innerHTML = '<tr><td colspan="8" class="empty-cell">Tidak ada dokumen yang sesuai dengan pencarian atau filter.</td></tr>';
  } else {
    $('arsipRows').innerHTML = pageItems.map((a, i) => {
      const selected = a.id === selectedDocId ? 'selected-row' : '';
      const size = esc(a.ukuran || 'PDF');
      return `<tr class="${selected}" data-doc-id="${esc(a.id)}">
        <td><input class="row-check" type="checkbox" aria-label="Pilih dokumen"></td>
        <td>${start + i + 1}</td>
        <td><div class="file-cell"><span class="pdf-icon">PDF</span><span class="file-name"><strong title="${esc(a.namaFile || a.nama)}">${esc(a.namaFile || a.nama || 'Dokumen')}</strong><small>PDF · ${size}</small></span></div></td>
        <td><span class="tag">${esc(shortCategory(a.nama || a.kategori))}</span></td>
        <td title="${esc(a.vendor)}">${esc(a.vendor || '—')}</td>
        <td>${esc(a.tanggal || '—')}</td>
        <td><span class="status ${a.status === 'Kurang' ? 'incomplete' : 'complete'}">${esc(a.status || 'Lengkap')}</span></td>
        <td><div class="row-actions"><button class="icon-btn view-doc" title="Preview" data-id="${esc(a.id)}">◉</button><button class="icon-btn download-row" title="Download" data-id="${esc(a.id)}">⇩</button></div></td>
      </tr>`;
    }).join('');
  }
  renderPagination(pages);
  $('arsipRows').querySelectorAll('tr[data-doc-id]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.type === 'checkbox') return;
      selectDocument(row.dataset.docId);
    });
  });
  $('arsipRows').querySelectorAll('.view-doc').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); selectDocument(b.dataset.id); }));
  $('arsipRows').querySelectorAll('.download-row').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); const doc = allData.arsip.find(x => x.id === b.dataset.id); if (doc) window.open(doc.downloadUrl || doc.link, '_blank', 'noopener');
  }));
  $('selectAll').checked = false;
}
function shortCategory(name) {
  const n = String(name || '');
  if (/invoice/i.test(n)) return 'Invoice';
  if (/\bpo\b|purchase order/i.test(n)) return 'PO';
  if (/surat jalan/i.test(n)) return 'Surat Jalan';
  if (/bast/i.test(n)) return 'BAST';
  if (/pembayaran/i.test(n)) return 'Pembayaran';
  return n.length > 18 ? n.slice(0,16) + '…' : n;
}
function renderPagination(pages) {
  let html = `<button data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>`;
  const nums = new Set([1, pages, currentPage, currentPage - 1, currentPage + 1]);
  [...nums].filter(n => n >= 1 && n <= pages).sort((a,b) => a-b).forEach((n, i, arr) => {
    if (i && n - arr[i-1] > 1) html += '<span>…</span>';
    html += `<button data-page="${n}" class="${n === currentPage ? 'active' : ''}">${n}</button>`;
  });
  html += `<button data-page="${currentPage + 1}" ${currentPage >= pages ? 'disabled' : ''}>›</button>`;
  $('pagination').innerHTML = html;
  $('pagination').querySelectorAll('button[data-page]').forEach(b => b.addEventListener('click', () => {
    const p = Number(b.dataset.page); if (p < 1 || p > pages) return; currentPage = p; renderArsipTable();
  }));
}
function selectedDoc() { return allData.arsip.find(a => a.id === selectedDocId); }
function selectDocument(id) {
  const doc = allData.arsip.find(a => a.id === id);
  if (!doc) return;
  selectedDocId = id;
  renderArsipTable();
  $('pdfFrameWrap').innerHTML = doc.previewUrl
    ? `<iframe src="${esc(doc.previewUrl)}" title="Preview ${esc(doc.namaFile)}" allow="autoplay"></iframe>`
    : `<div class="preview-placeholder"><span>▤</span><b>Preview tidak tersedia</b><small>Periksa tautan Google Drive</small></div>`;
  const detail = [
    ['Nama Dokumen', doc.namaFile || doc.nama || '—'],
    ['Kategori', shortCategory(doc.nama || doc.kategori)],
    ['Vendor', doc.vendor || '—'],
    ['Tanggal Upload', doc.tanggal || '—'],
    ['Ukuran File', doc.ukuran || '—'],
    ['Status', doc.status || 'Lengkap']
  ];
  $('documentDetails').innerHTML = detail.map(([k,v],i) => `<div><dt>${k}</dt><dd>${i === 5 ? `<span class="status complete">${esc(v)}</span>` : esc(v)}</dd></div>`).join('');
  $('downloadDoc').href = doc.downloadUrl || doc.link || '#';
  $('downloadDoc').classList.toggle('disabled', !(doc.downloadUrl || doc.link));
  $('openPreview').disabled = !(doc.previewUrl || doc.link);
  $('versionHistory').disabled = false;
}
function clearPreview() {
  selectedDocId = null;
  $('pdfFrameWrap').innerHTML = '<div class="preview-placeholder"><span>▤</span><b>Pilih dokumen untuk melihat preview</b><small>Preview PDF akan ditampilkan di sini</small></div>';
  $('documentDetails').innerHTML = '<div><dt>Nama Dokumen</dt><dd>—</dd></div><div><dt>Kategori</dt><dd>—</dd></div><div><dt>Vendor</dt><dd>—</dd></div><div><dt>Tanggal Upload</dt><dd>—</dd></div><div><dt>Ukuran File</dt><dd>—</dd></div><div><dt>Status</dt><dd>—</dd></div>';
  $('downloadDoc').href = '#'; $('downloadDoc').classList.add('disabled');
  $('openPreview').disabled = true; $('versionHistory').disabled = true;
  renderArsipTable();
}
function showHistory() {
  const doc = selectedDoc();
  $('historyContent').textContent = doc
    ? `Dokumen: ${doc.namaFile || doc.nama}. Data riwayat versi belum disimpan pada struktur Google Sheets yang sekarang. Untuk saat ini, gunakan fitur Version history pada Google Drive jika tersedia.`
    : 'Pilih dokumen terlebih dahulu.';
  $('historyModal').hidden = false;
}

function addDocRow() {
  const row = document.createElement('div');
  row.className = 'dokumen-row';
  row.innerHTML = `<label class="field-label">Jenis Dokumen<select class="doc-type"><option>Invoice</option><option>PO</option><option>Surat Jalan</option><option>BAST</option><option>Bukti Pembayaran</option><option>Faktur Pajak</option><option>Dokumen Pendukung</option></select></label><label class="field-label">File PDF<input type="file" class="doc-file" accept="application/pdf"></label><button type="button" class="remove-doc" title="Hapus baris">×</button>`;
  row.querySelector('.remove-doc').addEventListener('click', () => { row.remove(); updateRemoveButtons(); });
  $('dokumenContainer').appendChild(row);
  updateRemoveButtons();
}
function updateRemoveButtons() {
  const rows = [...document.querySelectorAll('.dokumen-row')];
  rows.forEach(r => r.querySelector('.remove-doc').disabled = rows.length === 1);
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Gagal membaca file ' + file.name));
    reader.readAsDataURL(file);
  });
}
function setBusy(id, busy, label) {
  const btn = $(id); if (!btn) return;
  if (!btn.dataset.original) btn.dataset.original = btn.textContent;
  btn.disabled = !!busy;
  btn.textContent = busy ? label : btn.dataset.original;
}
async function handleSaveVendor(e) {
  e.preventDefault();
  setBusy('v_submitBtn', true, 'Menyimpan...');
  $('vendorMessage').textContent = '';
  try {
    const file = $('v_file').files[0];
    if (file && file.type !== 'application/pdf') throw new Error('File izin harus PDF.');
    const payload = {
      nama: $('v_nama').value.trim(), tglMulai: $('v_mulai').value,
      tglAkhir: $('v_akhir').value, fileIzin: file ? await fileToBase64(file) : null
    };
    const result = await callAPI('saveVendor', payload);
    $('vendorForm').reset(); showToast(result.message); await initApp();
  } catch (err) { $('vendorMessage').textContent = err.message; }
  finally { setBusy('v_submitBtn', false, 'Simpan Vendor'); }
}
async function handleUploadTransaksi(e) {
  e.preventDefault();
  setBusy('submitBtn', true, 'Memproses...');
  $('formMessage').textContent = '';
  try {
    const rows = [...document.querySelectorAll('.dokumen-row')];
    const files = [];
    for (const row of rows) {
      const file = row.querySelector('.doc-file').files[0];
      if (file) {
        if (file.type !== 'application/pdf') throw new Error('Semua dokumen transaksi harus berupa PDF.');
        files.push({ jenis: row.querySelector('.doc-type').value, name: file.name, size: formatBytes(file.size), base64: await fileToBase64(file) });
      }
    }
    const payload = {
      tglInvoice: $('tglInvoice').value, vendor: $('vendor').value, lokasi: $('lokasi').value,
      noInv: $('noInv').value.trim(), noPO: $('noPO').value.trim(), volume: $('volume').value,
      total: $('total').value, statusBayar: $('statusBayar').value,
      statusDok: $('statusDok').value, catatan: $('catatan').value, files
    };
    const result = await callAPI('saveTransaksiDanDokumen', payload);
    $('uploadForm').reset();
    $('dokumenContainer').innerHTML = '';
    addDocRow();
    showToast(result.message);
    await initApp();
    switchTab('arsip');
  } catch (err) { $('formMessage').textContent = err.message; }
  finally { setBusy('submitBtn', false, 'Simpan Transaksi'); }
}
async function handleUploadLepas(e) {
  e.preventDefault();
  const selectedFiles = [...$('docFileLepas').files];
  if (!selectedFiles.length) { $('msgLepas').textContent = 'Pilih file terlebih dahulu.'; return; }
  setBusy('btnUploadLepas', true, 'Mengunggah...');
  $('msgLepas').textContent = '';
  try {
    const files = [];
    for (const file of selectedFiles) {
      if (file.type && file.type !== 'application/pdf') throw new Error('File arsip harus berupa PDF: ' + file.name);
      files.push({ name: file.name, mimeType: file.type || 'application/pdf', size: formatBytes(file.size), base64: await fileToBase64(file) });
    }
    const result = await callAPI('uploadDokumenLepas', {
      kategori: $('docKategori').value, namaDok: $('docNama').value.trim(),
      vendor: $('uploadVendor').value, files
    });
    $('uploadFormLepas').reset(); $('uploadVendorWrap').hidden = true;
    showToast(result.message); await initApp(); switchTab('arsip');
  } catch (err) { $('msgLepas').textContent = err.message; }
  finally { setBusy('btnUploadLepas', false, 'Upload ke Arsip'); }
}

function renderVendorMaster() {
  $('vendorCount').textContent = `${allData.vendors.length} vendor`;
  $('vendorMasterRows').innerHTML = allData.vendors.length ? allData.vendors.map(v => `
    <tr><td><b>${esc(v.nama)}</b></td><td>${esc(v.tglMulai || '—')}</td><td>${esc(v.tglAkhir || '—')}</td>
    <td>${statusBadge(v.status)}</td><td>${v.linkIzin ? `<a href="${esc(v.linkIzin)}" target="_blank" rel="noopener">Lihat PDF ↗</a>` : '—'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">Belum ada vendor.</td></tr>';
}
function renderIzin() {
  const sorted = [...allData.vendors].sort((a,b) => {
    const rank = s => s === 'Kedaluwarsa' ? 0 : s.indexOf('Akan Berakhir') === 0 ? 1 : s === 'Aktif' ? 2 : 3;
    return rank(a.status) - rank(b.status);
  });
  $('izinRows').innerHTML = sorted.length ? sorted.map(v => `<tr><td><b>${esc(v.nama)}</b></td><td>${esc(v.tglMulai || '—')}</td><td>${esc(v.tglAkhir || '—')}</td><td>${statusBadge(v.status)}</td><td>${v.linkIzin ? `<a href="${esc(v.linkIzin)}" target="_blank" rel="noopener">Lihat Izin ↗</a>` : 'Belum diunggah'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">Belum ada data izin vendor.</td></tr>';
}
function statusBadge(status) {
  const cls = status === 'Aktif' || status === 'Lengkap' || status === 'Lunas' ? 'complete' : (status === 'Kedaluwarsa' || status === 'Kurang' ? 'expired' : 'incomplete');
  return `<span class="status ${cls}">${esc(status || 'Belum Diisi')}</span>`;
}
function renderTransactions() {
  $('trxCount').textContent = `${allData.transaksi.length} transaksi`;
  $('transactionRows').innerHTML = allData.transaksi.length ? allData.transaksi.map(t => `<tr><td>${esc(t.id)}</td><td>${esc(t.tglInvoice || '—')}</td><td>${esc(t.vendor)}</td><td>${esc(t.noPO || '—')}</td><td>${Number(t.volume || 0).toLocaleString('id-ID')} L</td><td>${formatRupiah(t.total)}</td><td>${statusBadge(t.statusBayar)}</td><td>${statusBadge(t.statusDok)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">Belum ada transaksi.</td></tr>';
}
function renderLaporanVendor() {
  const keyword = ($('searchInput')?.value || '').toLowerCase().trim();
  const vendors = allData.vendors.filter(v => !keyword || v.nama.toLowerCase().includes(keyword) ||
    allData.transaksi.some(t => t.vendor === v.nama && (t.tglInvoice || '').toLowerCase().includes(keyword)));
  $('vendorRows').innerHTML = vendors.length ? vendors.map(v => {
    const trx = allData.transaksi.filter(t => t.vendor === v.nama && (!keyword || v.nama.toLowerCase().includes(keyword) || (t.tglInvoice || '').toLowerCase().includes(keyword)));
    const total = trx.reduce((sum,t) => sum + Number(t.total || 0), 0);
    const paid = trx.length && trx.every(t => t.statusBayar === 'Lunas');
    const docsOk = trx.every(t => t.statusDok !== 'Kurang');
    return `<tr><td><b>${esc(v.nama)}</b></td><td>${statusBadge(v.status)}</td><td>${trx.length} Trx</td><td>${formatRupiah(total)}</td><td>${statusBadge(trx.length ? (paid ? 'Lunas' : 'Belum Lunas') : '—')}</td><td>${statusBadge(trx.length ? (docsOk ? 'Lengkap' : 'Kurang') : '—')}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-cell">Belum ada data vendor/transaksi.</td></tr>';
}
function renderDashboard() {
  $('dashTotal').textContent = allData.arsip.length;
  $('dashVendor').textContent = allData.vendors.length;
  $('dashTrx').textContent = allData.transaksi.length;
  $('dashStorage').textContent = (allData.storage || {}).usedLabel || '0 B';
  $('recentRows').innerHTML = allData.arsip.slice(0,8).map(a => `<tr><td>${esc(a.namaFile || a.nama)}</td><td>${esc(a.kategori)}</td><td>${esc(a.vendor || '—')}</td><td>${esc(a.tanggal || '—')}</td><td><button class="icon-btn" data-recent="${esc(a.id)}">◉ Lihat</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-cell">Belum ada dokumen.</td></tr>';
  $('recentRows').querySelectorAll('[data-recent]').forEach(b => b.addEventListener('click', () => { switchTab('arsip'); selectDocument(b.dataset.recent); }));
}
function exportArsip() {
  const chosen = [...document.querySelectorAll('.row-check:checked')].map(c => c.closest('tr')?.dataset.docId).filter(Boolean);
  const data = chosen.length ? filteredDocs.filter(d => chosen.includes(d.id)) : filteredDocs;
  const rows = [['ID Dokumen','Tanggal Upload','Kategori','Nama Dokumen','Vendor','Nama File','Link PDF','Ukuran','Status'], ...data.map(d => [d.id,d.tanggal,d.kategori,d.nama,d.vendor,d.namaFile,d.link,d.ukuran,d.status])];
  downloadCSV(rows, 'arsip-dokumen.csv');
}
function exportReport() {
  const rows = [['Vendor','Status Izin','Total Transaksi','Total Tagihan','Status Bayar','Status Dokumen']];
  allData.vendors.forEach(v => {
    const trx = allData.transaksi.filter(t => t.vendor === v.nama);
    rows.push([v.nama,v.status,trx.length,trx.reduce((s,t)=>s+Number(t.total||0),0),trx.length && trx.every(t=>t.statusBayar==='Lunas')?'Lunas':'Belum Lunas',trx.some(t=>t.statusDok==='Kurang')?'Kurang':'Lengkap']);
  });
  downloadCSV(rows, 'rekap-vendor.csv');
}
function downloadCSV(rows, filename) {
  const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  showToast('File export berhasil dibuat.');
}
function formatRupiah(value) {
  return 'Rp ' + Number(value || 0).toLocaleString('id-ID');
}
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB','TB']; const i = Math.floor(Math.log(bytes)/Math.log(1024));
  return (bytes/Math.pow(1024,i)).toFixed(2)+' '+units[i];
}
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showToast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
