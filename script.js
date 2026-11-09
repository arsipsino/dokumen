// ============================================
// FRONTEND ARSIP DOKUMEN DIGITAL - PT SINO
// ============================================
const API_URL = "https://script.google.com/macros/s/AKfycbwJTyaGB4CCa9LVOa6nhHeGoZy5noRlGJhV8Q3VBzq5tYUNNpagP8MP8Sg_MLfyS8NY3w/exec";
const SESSION_KEY = "pt_sino_session";
let currentUser = null;
const $ = id => document.getElementById(id);
const PAGE_SIZE = 15;
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MiB
let allData = { vendors: [], transaksi: [], arsip: [], counts: {}, izin: {}, storage: {} };
let filteredDocs = [];
let currentPage = 1;
let selectedDocId = null;
let activeCategory = '';
let activeSubcategory = '';
let appliedFilters = { vendor: '', year: '', month: '', status: '' };
let toastTimer;
let purchaseData = { purchaseOrders: [], purchasingDocs: [] };
let purchaseLoadedAt = 0;
let chatPollTimer = null;
let chatLastIds = new Set();
let notificationTimer = null;
let notificationState = { unread: 0, items: [] };
let activityRowsCache = [];
let storageStatsRequested = false;

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  if ($('requestDate')) $('requestDate').value = new Date().toISOString().slice(0,10);
  if ($('requestItems') && !$('requestItems').children.length) addPurchaseRequestRow();
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
function isAdminUser(){return String(currentUser?.role||'').trim().toLowerCase()==='admin';}
function mountAccountPanels(){
  const mount=$('accountManagementMount');
  if(!mount)return;
  ['userAdminPanel','activityAdminPanel'].forEach(id=>{const panel=$(id);if(panel&&panel.parentElement!==mount)mount.appendChild(panel);});
}
function updateProfile(){
  const u=currentUser||{}, admin=isAdminUser();
  setText('profileName',u.displayName||u.username||'Pengguna');
  setText('profileRole',admin?'Administrator':'Pengguna');
  setText('profileAvatar',String(u.displayName||u.username||'U').charAt(0).toUpperCase());
  mountAccountPanels();
  setHidden('accountNavItem',!admin);
  setHidden('userAdminPanel',!admin);
  setHidden('activityAdminPanel',!admin);
  if(admin){loadUsers();loadActivityLogs();}
  startNotificationPolling();
}
async function handleLogin(e){e.preventDefault();const b=$('loginButton');b.disabled=true;b.textContent='Memeriksa…';setText('loginMessage','');try{const data=await callAPI('login',{username:$('loginUsername').value.trim(),password:$('loginPassword').value});sessionStorage.setItem(SESSION_KEY,JSON.stringify(data));currentUser=data.user;setHidden('loginScreen',true);setHidden('appShell',false);updateProfile();await initApp();}catch(err){setText('loginMessage',err.message||'Login gagal.');}finally{b.disabled=false;b.textContent='Masuk ke Sistem';}}
async function handleLogout(){stopNotificationPolling();stopChatPolling();try{await callAPI('logout');}catch(_){}sessionStorage.removeItem(SESSION_KEY);currentUser=null;showLogin('Anda telah keluar dari sistem.');}
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
    if (!storageStatsRequested) { storageStatsRequested = true; loadStorageStats(); }
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
  on('cancelEditTrx', 'click', resetTransactionForm);
  on('uploadFormLepas', 'submit', handleUploadLepas);
  on('vendorForm', 'submit', handleSaveVendor);
  on('searchInput', 'input', renderLaporanVendor);
  on('docKategori', 'change', () => setHidden('uploadVendorWrap', $('docKategori').value !== 'VENDOR'));
  on('loginForm', 'submit', handleLogin);
  on('logoutButton', 'click', handleLogout);
  on('createUserForm', 'submit', handleCreateUser);
  on('poUploadForm', 'submit', handlePOUpload);
  on('purchasingUploadForm', 'submit', handlePurchasingUpload);
  on('purchaseRequestForm', 'submit', handlePurchaseRequestSave);
  on('addRequestItem', 'click', () => addPurchaseRequestRow());
  on('requestItems', 'click', e => { const b=e.target.closest('[data-remove-request-row]'); if(b){const rows=document.querySelectorAll('.request-item-row');if(rows.length>1)b.closest('.request-item-row').remove();else showToast('Minimal harus ada satu baris barang.');} });
  on('poFile', 'change', () => validateUploadSelection('poFile', 'poMessage', false));
  on('purFiles', 'change', () => validateUploadSelection('purFiles', 'purMessage', true));
  on('refreshPO', 'click', () => loadPurchaseData(true));
  on('poSearch', 'input', renderPurchaseTables);
  on('notificationButton','click',()=>{setHidden('notificationPanel',!$('notificationPanel').hidden);loadNotifications();});
  on('markNotificationsRead','click',markNotificationsRead);
  on('refreshActivity','click',loadActivityLogs);
  on('applyActivityFilter','click',loadActivityLogs);
  on('refreshPurchasing', 'click', loadPurchaseData);
  on('chatForm', 'submit', handleSendChat);
  on('chatAttachment', 'change', handleChatAttachmentSelect);
  on('chatAttachmentClear', 'click', clearChatAttachment);
  on('refreshChat', 'click', loadChatMessages);
}


function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.hidden = true);
  if(tabId==='akun'&&!isAdminUser()){showToast('Menu Manajemen Akun hanya untuk administrator.');return;}
  const target = $('tab-' + tabId);
  if (target) target.hidden = false;
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  const titles = { dashboard:'Dashboard', vendor:'Master Vendor', izin:'Izin Vendor / Dokumen Legalitas Vendor', transaksi:'Transaksi Pembelian', arsip:'Arsip Dokumen Digital', upload:'Upload Dokumen', po:'Arsip Purchase Order', purchasing:'Dokumen Purchasing', chat:'Chat Internal', laporan:'Rekap Laporan', pengaturan:'Pengaturan', akun:'Manajemen Akun' };
  $('pageTitle').textContent = titles[tabId] || 'Arsip Dokumen Digital';
  $('sidebar').classList.remove('open');
  if (tabId === 'izin') renderIzin();
  if (tabId === 'vendor') renderVendorMaster();
  if (tabId === 'transaksi') renderTransactions();
  if (tabId === 'laporan') renderLaporanVendor();
  if (tabId === 'po' || tabId === 'purchasing') loadPurchaseData();
  if (tabId === 'chat') { loadChatMessages(); startChatPolling(); } else stopChatPolling();
  if (tabId === 'pengaturan' && isAdminUser()) loadActivityLogs();
  if (tabId === 'akun' && isAdminUser()) { loadUsers(); loadActivityLogs(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function callAPI(action, payload = {}, onProgress = null) {
  // Fetch API avoids the XHR + Apps Script redirect/CORS failure seen on uploads.
  const session = getSession();
  const request = { action, payload: payload || {} };
  if (action !== 'login' && action !== 'logout') {
    if (!session || !session.token) throw new Error('Sesi login berakhir. Silakan masuk kembali.');
    request.token = session.token;
  } else if (action === 'logout' && session) {
    request.token = session.token;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);
  let raw;
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(request),
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Web App mengembalikan HTTP ' + response.status);
    raw = await response.text();
  } catch (networkError) {
    if (networkError && networkError.name === 'AbortError') {
      throw new Error('Permintaan melewati batas waktu 5 menit. Coba unggah satu PDF terlebih dahulu atau gunakan koneksi yang lebih stabil.');
    }
    if (networkError && /^Web App mengembalikan HTTP/.test(networkError.message || '')) throw networkError;
    throw new Error('Tidak dapat menyelesaikan koneksi ke Google Apps Script. Periksa koneksi internet dan deployment Web App, lalu coba lagi. Detail: ' + (networkError.message || networkError));
  } finally {
    clearTimeout(timeoutId);
  }

  let result;
  try { result = JSON.parse(raw); }
  catch (_) { throw new Error('Respons Google Apps Script bukan JSON. Pastikan deployment Web App menggunakan versi terbaru dan URL berakhiran /exec.'); }
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
  ['poVendor','purVendor'].forEach(id => { const el=$(id); if(el) el.innerHTML='<option value="">Pilih Vendor (opsional)</option>'+options; });
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
    ['Tanggal Invoice', doc.tanggal || '—'],
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
  $('documentDetails').innerHTML = '<div><dt>Nama Dokumen</dt><dd>—</dd></div><div><dt>Kategori</dt><dd>—</dd></div><div><dt>Vendor</dt><dd>—</dd></div><div><dt>Tanggal Invoice</dt><dd>—</dd></div><div><dt>Ukuran File</dt><dd>—</dd></div><div><dt>Status</dt><dd>—</dd></div>';
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
function validateUploadSelection(inputId, messageId, multiple) {
  const input = $(inputId);
  const files = input ? [...input.files] : [];
  if (!files.length) { setText(messageId, ''); return true; }
  for (const file of files) {
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      const message = `File harus PDF: ${file.name}`;
      setText(messageId, message); showToast(message); return false;
    }
    if (file.size > MAX_PDF_BYTES) {
      const size = formatBytes(file.size);
      const message = `Upload dibatalkan: ${file.name} berukuran ${size}. Batas maksimal 8 MB per file. Silakan kompres PDF atau pilih file yang lebih kecil.`;
      setText(messageId, message); showToast(message); return false;
    }
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  setText(messageId, multiple && files.length > 1
    ? `${files.length} file dipilih (${formatBytes(total)} total). Maksimal 8 MB untuk setiap file.`
    : `${files[0].name} (${formatBytes(files[0].size)}) siap diunggah.`);
  return true;
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
  const editingId = $('editTrxId').value;
  setBusy('submitBtn', true, editingId ? 'Menyimpan perubahan...' : 'Memproses...');
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
    const unitSelect = $('satuan');
    const selectedUnit = unitSelect && unitSelect.selectedOptions && unitSelect.selectedOptions.length
      ? unitSelect.selectedOptions[0].value
      : (unitSelect ? unitSelect.value : '');
    const allowedUnits = ['Liter', 'PCS', 'Pack', 'Set'];
    if (!allowedUnits.includes(selectedUnit)) {
      throw new Error('Pilih satuan kuantitas terlebih dahulu: Liter, PCS, Pack, atau Set.');
    }
    const payload = {
      id: editingId,
      tglInvoice: $('tglInvoice').value, vendor: $('vendor').value, lokasi: $('lokasi').value,
      noInv: $('noInv').value.trim(), noPO: $('noPO').value.trim(), volume: $('volume').value,
      satuan: selectedUnit, satuanKuantitas: selectedUnit, unit: selectedUnit,
      total: $('total').value, statusBayar: $('statusBayar').value,
      statusDok: $('statusDok').value, catatan: $('catatan').value, files
    };
    const result = await callAPI(editingId ? 'updateTransaksi' : 'saveTransaksiDanDokumen', payload);
    resetTransactionForm();
    showToast(result.message + (result.satuan ? ' Satuan tersimpan: ' + result.satuan + '.' : ''));
    await initApp();
    switchTab('transaksi');
  } catch (err) { $('formMessage').textContent = err.message; }
  finally { setBusy('submitBtn', false, $('editTrxId').value ? 'Simpan Perubahan' : 'Simpan Transaksi'); }
}

function resetTransactionForm() {
  const form = $('uploadForm');
  if (form) form.reset();
  $('editTrxId').value = '';
  $('dokumenContainer').innerHTML = '';
  addDocRow();
  setText('transactionFormTitle','Tambah Transaksi & Upload Dokumen');
  $('submitBtn').textContent = 'Simpan Transaksi';
  setHidden('cancelEditTrx',true);
  setText('formMessage','');
}

function editTransaction(id) {
  const t = allData.transaksi.find(x => x.id === id);
  if (!t) return;
  $('editTrxId').value = t.id;
  $('tglInvoice').value = t.tglInvoice || '';
  $('vendor').value = t.vendor || '';
  $('lokasi').value = t.lokasi || '';
  $('noInv').value = t.noInv || '';
  $('noPO').value = t.noPO || '';
  $('volume').value = t.volume || '';
  $('satuan').value = t.satuan || 'Liter';
  $('total').value = t.total || '';
  $('statusBayar').value = t.statusBayar || 'Belum Bayar';
  $('statusDok').value = t.statusDok || 'Lengkap';
  $('catatan').value = t.catatan || '';
  $('dokumenContainer').innerHTML = '';
  addDocRow();
  setText('transactionFormTitle','Edit Transaksi · '+t.id);
  $('submitBtn').textContent = 'Simpan Perubahan';
  setHidden('cancelEditTrx',false);
  setText('formMessage','Dokumen tambahan dapat dilampirkan di bawah. Dokumen lama tetap tersimpan.');
  $('uploadForm').scrollIntoView({behavior:'smooth',block:'start'});
}

async function deleteTransaction(id) {
  const t = allData.transaksi.find(x => x.id === id);
  if (!t) return;
  const ok = window.confirm('Hapus transaksi '+t.noInv+' ('+t.id+') beserta seluruh baris arsip dan file PDF terkait? File PDF akan dipindahkan ke Trash Google Drive.');
  if (!ok) return;
  try {
    const result = await callAPI('deleteTransaksi',{id});
    showToast(result.message);
    if ($('editTrxId').value === id) resetTransactionForm();
    await initApp();
  } catch(err) { showToast('Gagal menghapus: '+err.message); }
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

async function loadPurchaseData(force = false) {
  if (!force && purchaseLoadedAt && Date.now()-purchaseLoadedAt < 30000) { renderPurchaseTables(); return; }
  try {
    purchaseData = await callAPI('getPurchaseData');
    purchaseLoadedAt = Date.now();
    renderPurchaseTables();
  } catch (err) {
    if ($('poRows')) $('poRows').innerHTML = `<tr><td colspan="7" class="empty-cell">${esc(err.message)}</td></tr>`;
    if ($('purRows')) $('purRows').innerHTML = `<tr><td colspan="8" class="empty-cell">${esc(err.message)}</td></tr>`;
  }
}
function renderPurchaseTables() {
  const allPos = purchaseData.purchaseOrders || [];
  const q = String($('poSearch')?.value || '').trim().toLowerCase();
  const pos = allPos.filter(p => !q || [p.noPO,p.vendor,p.proyek,p.tanggal,p.namaFile,p.pengunggah,p.judul].join(' ').toLowerCase().includes(q));
  const docs = purchaseData.purchasingDocs || [];
  setText('poCount', `${allPos.length} dokumen`); setText('poSearchCount', q ? `${pos.length} hasil ditemukan` : '');
  setText('purCount', `${docs.length} dokumen`);
  if ($('poRows')) $('poRows').innerHTML = pos.length ? pos.map(p => `<tr><td>${esc(p.tanggal||'—')}</td><td><b>${esc(p.noPO)}</b></td><td>${esc(p.vendor||'—')}</td><td>${esc(p.proyek||'—')}</td><td>${esc(p.namaFile)}</td><td>${esc(p.pengunggah||'—')}</td><td><a class="btn btn-outline btn-small" href="${esc(p.link)}" target="_blank" rel="noopener">Lihat PDF ↗</a></td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">Belum ada Purchase Order.</td></tr>';
  if ($('purRows')) $('purRows').innerHTML = docs.length ? docs.map(d => `<tr><td>${esc(d.tanggal||'—')}</td><td><span class="tag">${esc(d.jenis)}</span></td><td>${esc(d.judul||'—')}</td><td>${esc(d.vendor||'—')}</td><td>${esc(d.noPO||'—')}</td><td>${esc(d.namaFile)}</td><td>${esc(d.pengunggah||'—')}</td><td><a class="btn btn-outline btn-small" href="${esc(d.link)}" target="_blank" rel="noopener">Lihat PDF ↗</a></td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">Belum ada dokumen Purchasing.</td></tr>';
}
async function handlePOUpload(e) {
  e.preventDefault();
  const file = $('poFile').files[0];
  if (!file) { setText('poMessage','Pilih file PDF PO.'); return; }
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setText('poMessage','File PO harus PDF.'); return; }
  if (file.size > MAX_PDF_BYTES) { const msg = `Upload dibatalkan: ${file.name} berukuran ${formatBytes(file.size)}. Batas maksimal 8 MB. Kompres PDF atau pilih file yang lebih kecil.`; setText('poMessage',msg); showToast(msg); return; }
  setBusy('poSubmit',true,'Mengunggah…'); setText('poMessage','');
  try {
    const poProgress=$('poProgress'); if(poProgress){poProgress.hidden=false;poProgress.removeAttribute('value');}
    setText('poMessage','Membaca PDF dan mengirim ke Google Drive. Mohon tunggu, jangan tutup halaman…');
    const encodedFile = await fileToBase64(file);
    setText('poMessage','File sudah siap. Menyimpan ke Google Drive dan Google Sheets…');
    const result = await callAPI('uploadPurchaseOrder',{tanggal:$('poTanggal').value,noPO:$('poNomor').value.trim(),vendor:$('poVendor').value,proyek:$('poProyek').value.trim(),judul:$('poJudul').value.trim(),file:{name:file.name,base64:encodedFile}});
    $('poUploadForm').reset(); showToast(result.message); purchaseLoadedAt=0; await loadPurchaseData(true); await loadNotifications(); loadStorageStats();
  } catch(err) { setText('poMessage',err.message); }
  finally { setBusy('poSubmit',false,'Upload PO'); if($('poProgress'))$('poProgress').hidden=true; }
}
function addPurchaseRequestRow(data={}) {
  const host=$('requestItems'); if(!host)return;
  const row=document.createElement('div'); row.className='request-item-row';
  const fields=[['name','Nama barang','text',data.name||''],['qty','Qty','text',data.qty||''],['unit','Satuan','text',data.unit||''],['price','Harga satuan','text',data.price||''],['nominal','Nominal','text',data.nominal||''],['pph','PPH','text',data.pph||''],['ppn','PPN','text',data.ppn||''],['total','Jumlah','text',data.total||''],['stock','Sisa stok sebelumnya','text',data.stock||''],['vendor','Nama vendor','text',data.vendor||''],['note','Keterangan','text',data.note||'']];
  row.innerHTML=fields.map(([key,label,type,value])=>`<label class="field-label">${label}<input data-request-field="${key}" type="${type}" value="${esc(value)}" placeholder="${label}"></label>`).join('')+`<button type="button" class="btn btn-danger request-row-remove" data-remove-request-row aria-label="Hapus baris">×</button>`;
  host.appendChild(row);
}
async function handlePurchaseRequestSave(e) {
  e.preventDefault();
  const rows=[...document.querySelectorAll('.request-item-row')];
  const items=rows.map(row=>{const item={};row.querySelectorAll('[data-request-field]').forEach(input=>item[input.dataset.requestField]=input.value.trim());return item;});
  const payload={company:$('requestCompany').value.trim(),requester:$('requesterName').value.trim(),position:$('requesterPosition').value.trim(),date:$('requestDate').value,location:$('requestLocation').value.trim(),approver:$('approverName').value.trim(),items};
  const button=$('requestSaveButton');button.disabled=true;button.textContent='Membuat PDF…';setText('requestMessage','Membuat formulir PDF dan menyimpan ke Google Drive…');
  try {
    const result=await callAPI('savePurchaseRequest',payload);
    setText('requestMessage',result.message+' ID: '+result.id);
    showToast('Formulir berhasil disimpan.');
    if(result.link) window.open(result.link,'_blank','noopener');
    const form=$('purchaseRequestForm');form.reset();$('requestDate').value=new Date().toISOString().slice(0,10);$('requestItems').innerHTML='';addPurchaseRequestRow();
    purchaseLoadedAt=0;await loadPurchaseData(true);loadStorageStats();
  } catch(err){setText('requestMessage',err.message||'Gagal menyimpan formulir.');}
  finally{button.disabled=false;button.textContent='Buat & Simpan PDF';}
}


async function handlePurchasingUpload(e) {
  e.preventDefault();
  const files=[...$('purFiles').files];
  if(!files.length){setText('purMessage','Pilih minimal satu file PDF.');return;}
  for(const f of files){if((f.type!=='application/pdf'&&!/\.pdf$/i.test(f.name))){const msg='Semua file harus PDF: '+f.name;setText('purMessage',msg);showToast(msg);return;}if(f.size>MAX_PDF_BYTES){const msg=`Upload dibatalkan: ${f.name} berukuran ${formatBytes(f.size)}. Batas maksimal 8 MB per file. Kompres PDF atau pilih file yang lebih kecil.`;setText('purMessage',msg);showToast(msg);return;}}
  setBusy('purSubmit',true,'Mengunggah…');setText('purMessage','');
  try {
    // Kirim satu PDF per permintaan secara berurutan agar payload tidak terlalu besar.
    const purProgress=$('purProgress'); if(purProgress){purProgress.hidden=false;purProgress.removeAttribute('value');}
    let savedCount = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setText('purMessage', `Menyiapkan ${i+1}/${files.length}: ${f.name}`);
      const encodedFile = await fileToBase64(f);
      setText('purMessage', `Mengunggah ${i+1}/${files.length}: ${f.name}. Mohon tunggu…`);
      await callAPI('uploadPurchasingDocuments', {
        jenis:$('purJenis').value,
        tanggal:$('purTanggal').value,
        judul:$('purJudul').value.trim(),
        vendor:$('purVendor').value,
        noPO:$('purNoPO').value.trim(),
        files:[{name:f.name,base64:encodedFile}]
      });
      savedCount++;
      setText('purMessage', `${savedCount}/${files.length} dokumen berhasil disimpan.`);
    }
    $('purchasingUploadForm').reset();showToast(savedCount + ' dokumen Purchasing berhasil diunggah.');purchaseLoadedAt=0;await loadPurchaseData(true);loadStorageStats();
  } catch(err){setText('purMessage',err.message);}
  finally{setBusy('purSubmit',false,'Upload Dokumen');if($('purProgress'))$('purProgress').hidden=true;}
}
async function loadChatMessages() {
  try {
    const messages=await callAPI('getChatMessages');
    const box=$('chatMessages'); if(!box)return;
    const wasNearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
    box.innerHTML=messages.length?messages.map(m=>{
      const attachment = m.lampiran ? (String(m.lampiran.mime||'').startsWith('image/')
        ? `<a class="chat-attachment-card chat-image-card" href="${esc(m.lampiran.url)}" target="_blank" rel="noopener"><img src="${esc(m.lampiran.previewUrl || m.lampiran.url)}" alt="${esc(m.lampiran.nama)}" loading="lazy"><span>▧ ${esc(m.lampiran.nama)} · ${esc(m.lampiran.ukuran)}</span></a>`
        : `<a class="chat-attachment-card chat-pdf-card" href="${esc(m.lampiran.url)}" target="_blank" rel="noopener"><span class="chat-pdf-icon">PDF</span><span><b>${esc(m.lampiran.nama)}</b><small>${esc(m.lampiran.ukuran)} · Buka dokumen</small></span><span class="chat-file-open">↗</span></a>`
      ) : '';
      return `<article class="chat-message ${m.username===currentUser?.username?'mine':''}"><div class="chat-message-meta"><b>${esc(m.nama)}</b><span>@${esc(m.username)} · ${esc(m.waktu)}</span></div>${m.pesan?`<p>${esc(m.pesan).replace(/\n/g,'<br>')}</p>`:''}${attachment}</article>`;
    }).join(''):'<div class="chat-empty">Belum ada percakapan. Mulai obrolan bersama tim.</div>';
    if(wasNearBottom)box.scrollTop=box.scrollHeight;
  } catch(err) { if($('chatMessages'))$('chatMessages').innerHTML=`<div class="chat-empty">${esc(err.message)}</div>`; }
}
const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CHAT_PDF_BYTES = 8 * 1024 * 1024;
function handleChatAttachmentSelect() {
  const input = $('chatAttachment');
  const file = input && input.files ? input.files[0] : null;
  if (!file) { setText('chatAttachmentName','Belum ada lampiran'); setText('chatAttachmentMessage','Gambar maksimal 5 MB · PDF maksimal 8 MB.'); setHidden('chatAttachmentClear',true); return; }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = ['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || /\.(jpe?g|png|webp|gif)$/i.test(file.name);
  const max = isPdf ? MAX_CHAT_PDF_BYTES : MAX_CHAT_IMAGE_BYTES;
  if ((!isPdf && !isImage) || file.size > max || file.size === 0) {
    const message = !isPdf && !isImage
      ? 'Format tidak didukung. Pilih PDF, JPG, PNG, WEBP, atau GIF.'
      : `Ukuran ${file.name} (${formatBytes(file.size)}) melebihi batas ${isPdf?'8 MB':'5 MB'} atau file kosong.`;
    input.value = ''; setText('chatAttachmentName','Belum ada lampiran'); setText('chatAttachmentMessage',message); setHidden('chatAttachmentClear',true); showToast(message); return;
  }
  setText('chatAttachmentName',`${file.name} (${formatBytes(file.size)})`);
  setText('chatAttachmentMessage',isPdf?'PDF siap dikirim.':'Gambar siap dikirim.');
  setHidden('chatAttachmentClear',false);
}
function clearChatAttachment() {
  if ($('chatAttachment')) $('chatAttachment').value='';
  setText('chatAttachmentName','Belum ada lampiran');
  setText('chatAttachmentMessage','Gambar maksimal 5 MB · PDF maksimal 8 MB.');
  setHidden('chatAttachmentClear',true);
}
async function handleSendChat(e) {
  e.preventDefault();
  const input=$('chatInput');
  const message=input.value.trim();
  const file=$('chatAttachment')?.files?.[0] || null;
  if(!message && !file){showToast('Tulis pesan atau pilih gambar/PDF terlebih dahulu.');return;}
  if(file){
    const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
    const isImage=['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||/\.(jpe?g|png|webp|gif)$/i.test(file.name);
    const max=isPdf?MAX_CHAT_PDF_BYTES:MAX_CHAT_IMAGE_BYTES;
    if((!isPdf&&!isImage)||file.size>max){handleChatAttachmentSelect();return;}
  }
  setBusy('chatSend',true,'Mengirim…');
  try {
    const payload={message};
    if(file){setText('chatAttachmentMessage','Membaca lampiran dan mengirim ke Google Drive…');payload.file={name:file.name,mime:file.type,base64:await fileToBase64(file)};}
    await callAPI('sendChatMessage',payload);
    input.value=''; clearChatAttachment(); await loadChatMessages(); await loadNotifications(); input.focus();
  } catch(err){showToast(err.message);setText('chatAttachmentMessage',err.message);}
  finally{setBusy('chatSend',false,'Kirim');}
}
function startChatPolling(){stopChatPolling();chatPollTimer=setInterval(()=>{if(!$('tab-chat')?.hidden)loadChatMessages();},6000);}
function stopChatPolling(){if(chatPollTimer){clearInterval(chatPollTimer);chatPollTimer=null;}}

async function loadStorageStats(){
  try{const stats=await callAPI('getStorageStats');const bytes=Number(stats.usedBytes||0);if(allData.storage)allData.storage.usedBytes=bytes;setText('storageText',(stats.usedLabel||formatBytes(bytes))+' / kuota akun Drive');if($('storageBar'))$('storageBar').style.width=Math.min(100,bytes/(100*1024**3)*100)+'%';}
  catch(err){console.warn('Info penyimpanan:',err.message);}
}

async function loadNotifications() {
  try {
    notificationState = await callAPI('getNotificationSummary');
    const total = Number(notificationState.unread || 0);
    const counts = {notificationBadge:total,poNavBadge:Number(notificationState.unreadPO||0),chatNavBadge:Number(notificationState.unreadCHAT||0)};
    Object.keys(counts).forEach(id => { const el=$(id); if(!el)return; const n=counts[id]; el.hidden=n<1; el.textContent=n>99?'99+':String(n); });
    const box=$('notificationItems'); if(!box)return;
    const items=notificationState.items||[];
    box.innerHTML=items.length?items.map(n=>`<button type="button" class="notification-item" data-notif-type="${esc(n.type)}"><b>${esc(n.title)}</b><span>${esc(n.message)}</span><small>${esc(n.sender)} · ${esc(n.waktu)}</small></button>`).join(''):'<p class="notification-empty">Tidak ada notifikasi baru.</p>';
    box.querySelectorAll('[data-notif-type]').forEach(b=>b.addEventListener('click',async()=>{const type=b.dataset.notifType;setHidden('notificationPanel',true);await markNotificationsRead();switchTab(type==='CHAT'?'chat':'po');}));
  } catch(err) { console.warn('Notifikasi:',err.message); }
}
async function markNotificationsRead(){try{await callAPI('markNotificationsRead');notificationState.unread=0;await loadNotifications();}catch(err){showToast(err.message);}}
function startNotificationPolling(){stopNotificationPolling();loadNotifications();notificationTimer=setInterval(()=>{if(!document.hidden)loadNotifications();},20000);}
function stopNotificationPolling(){if(notificationTimer){clearInterval(notificationTimer);notificationTimer=null;}}
async function loadActivityLogs(){
  if(currentUser?.role!=='admin')return;
  try{
    activityRowsCache=await callAPI('adminGetActivityLogs',{q:$('activitySearch')?.value||'',username:$('activityUser')?.value||'',limit:300});
    renderActivityLogs();
  }catch(err){if($('activityRows'))$('activityRows').innerHTML=`<tr><td colspan="5" class="empty-cell">${esc(err.message)}</td></tr>`;}
}
function renderActivityLogs(){
  const rows=$('activityRows');if(!rows)return;
  rows.innerHTML=activityRowsCache.length?activityRowsCache.map(r=>`<tr><td>${esc(r.waktu)}</td><td>${esc(r.username)}</td><td>${esc(r.nama)}</td><td><span class="tag">${esc(r.aksi)}</span></td><td>${esc(r.keterangan)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-cell">Belum ada aktivitas yang tercatat.</td></tr>';
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
  $('izinRows').innerHTML = sorted.length ? sorted.map(v => `<tr><td><b>${esc(v.nama)}</b></td><td>${esc(v.tglMulai || '—')}</td><td>${esc(v.tglAkhir || '—')}</td><td>${statusBadge(v.status)}</td><td>${v.linkIzin ? `<a href="${esc(v.linkIzin)}" target="_blank" rel="noopener">Lihat Dokumen ↗</a>` : 'Belum diunggah'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">Belum ada data izin vendor.</td></tr>';
}
function statusBadge(status) {
  const cls = status === 'Aktif' || status === 'Lengkap' || status === 'Lunas' ? 'complete' : (status === 'Kedaluwarsa' || status === 'Kurang' ? 'expired' : 'incomplete');
  return `<span class="status ${cls}">${esc(status || 'Belum Diisi')}</span>`;
}
function renderTransactions() {
  $('trxCount').textContent = `${allData.transaksi.length} transaksi`;
  $('transactionRows').innerHTML = allData.transaksi.length ? allData.transaksi.map(t => `<tr><td>${esc(t.id)}</td><td>${esc(t.tglInvoice || '—')}</td><td>${esc(t.vendor)}</td><td>${esc(t.noPO || '—')}</td><td>${Number(t.volume || 0).toLocaleString('id-ID')} ${esc(t.satuan || 'Liter')}</td><td>${formatRupiah(t.total)}</td><td>${statusBadge(t.statusBayar)}</td><td>${statusBadge(t.statusDok)}</td><td><div class="row-actions"><button type="button" class="btn btn-outline btn-small" data-edit-trx="${esc(t.id)}">Edit</button><button type="button" class="btn btn-danger btn-small" data-delete-trx="${esc(t.id)}">Hapus</button></div></td></tr>`).join('') : '<tr><td colspan="9" class="empty-cell">Belum ada transaksi.</td></tr>';
  $('transactionRows').querySelectorAll('[data-edit-trx]').forEach(b=>b.addEventListener('click',()=>editTransaction(b.dataset.editTrx)));
  $('transactionRows').querySelectorAll('[data-delete-trx]').forEach(b=>b.addEventListener('click',()=>deleteTransaction(b.dataset.deleteTrx)));
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
  const rows = [['ID Dokumen','Tanggal Invoice','Kategori','Nama Dokumen','Vendor','Nama File','Link PDF','Ukuran','Status'], ...data.map(d => [d.id,d.tanggal,d.kategori,d.nama,d.vendor,d.namaFile,d.link,d.ukuran,d.status])];
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
