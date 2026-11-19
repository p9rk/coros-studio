/* ============================================================
   قارئ PDF — المنطق الرئيسي
   يعتمد على PDF.js (مُضمّن محليًا)
   سكربت عادي (غير مُعتمد على ES Modules) ليعمل داخل الإطارات المضمّنة المحجوبة
   ============================================================ */
(function () {
'use strict';

const {
  putDoc, getDoc, getAllDocs, deleteDoc,
  putMark, deleteMark, getMarksForDoc,
} = window.PDFDB;

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js?v=5';

/* ---------- أدوات مساعدة ---------- */
const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));

const HL_COLORS = {
  yellow: '#ffd60a',
  green: '#30d158',
  blue: '#0a84ff',
  pink: '#ff375f',
  purple: '#bf5af2',
};
const SAMPLE_URL = './assets/sample.pdf';

/* ---------- عناصر الواجهة ---------- */
const el = {
  app: $('app'),
  sidebar: $('sidebar'),
  stage: $('stage'),
  pages: $('pages'),
  empty: $('emptyState'),
  docList: $('docList'),
  libCount: $('libCount'),
  search: $('searchInput'),
  openBtn: $('openBtn'),
  emptyOpenBtn: $('emptyOpenBtn'),
  sampleBtn: $('sampleBtn'),
  fileInputs: [...document.querySelectorAll('.file-input')],
  docTitle: $('docTitle'),
  docSub: $('docSub'),
  topbar: $('topbar'),
  darkPdfBtn: $('darkPdfBtn'),
  nightBtn: $('nightBtn'),
  bookmarkBtn: $('bookmarkBtn'),
  panelBtn: $('panelBtn'),
  closeDocBtn: $('closeDocBtn'),
  menuBtn: $('menuBtn'),
  closeSidebar: $('closeSidebar'),
  pageBar: $('pageBar'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),
  pageInput: $('pageInput'),
  pageTotal: $('pageTotal'),
  zoomInBtn: $('zoomInBtn'),
  zoomOutBtn: $('zoomOutBtn'),
  zoomLabel: $('zoomLabel'),
  comfort: $('comfort'),
  darkRange: $('darkRange'),
  warmRange: $('warmRange'),
  closeComfort: $('closeComfort'),
  panel: $('panel'),
  panelBody: $('panelBody'),
  closePanel: $('closePanel'),
  selMenu: $('selectionMenu'),
  swatches: $('swatches'),
  smHighlight: $('smHighlight'),
  smCopy: $('smCopy'),
  toast: $('toast'),
  loader: $('loader'),
  loaderText: $('loaderText'),
  scrim: $('scrim'),
};

/* ---------- الحالة ---------- */
const prefs = loadPrefs();
const state = {
  docs: [],
  doc: null,          // سجل الملف الحالي
  pdf: null,          // وثيقة PDF.js
  dims: [],           // أبعاد كل صفحة عند scale=1
  pageEls: [],
  marks: [],
  page: 1,
  zoom: prefs.zoom || 1,
  fit: prefs.fit || 'width',
  gen: 0,
  dark: { on: !!prefs.darkOn, intensity: prefs.darkIntensity ?? 88 },
  night: { on: !!prefs.nightOn, warm: prefs.warm ?? 35 },
  comfortHidden: false,
  sel: null,          // التحديد الحالي
  selColor: 'yellow',
  rendering: new Set(),
};

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('pdfreader.prefs') || '{}'); } catch { return {}; }
}
function savePrefs() {
  localStorage.setItem('pdfreader.prefs', JSON.stringify({
    zoom: state.zoom, fit: state.fit,
    darkOn: state.dark.on, darkIntensity: state.dark.intensity,
    nightOn: state.night.on, warm: state.night.warm,
  }));
}

/* ---------- Toast / Loader ---------- */
let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('show');
    setTimeout(() => (el.toast.hidden = true), 320);
  }, 2400);
}
function showLoader(text) { el.loaderText.textContent = text || 'جارٍ المعالجة…'; el.loader.hidden = false; }
function hideLoader() { el.loader.hidden = true; }

/* ============================================================
   المكتبة
   ============================================================ */
async function refreshLibrary() {
  state.docs = await getAllDocs();
  renderDocList();
}

function renderDocList() {
  const q = el.search.value.trim().toLowerCase();
  const docs = q ? state.docs.filter((d) => d.name.toLowerCase().includes(q)) : state.docs;
  el.docList.innerHTML = '';

  if (!docs.length) {
    el.docList.innerHTML = `<div class="lib-empty">${q ? 'لا نتائج مطابقة' : 'مكتبتك فارغة<br>افتح ملف PDF للبدء'}</div>`;
  }

  docs.forEach((d) => {
    const item = document.createElement('div');
    item.className = 'doc-item' + (state.doc && state.doc.id === d.id ? ' active' : '');
    item.dataset.id = d.id;

    const thumb = document.createElement('div');
    thumb.className = 'doc-thumb';
    if (d.thumb) {
      const img = document.createElement('img');
      img.src = d.thumb; img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 3.5h6.2L18 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5Z" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 3.6V9h5.4" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    }

    const meta = document.createElement('div');
    meta.className = 'doc-meta';
    meta.innerHTML = `<div class="doc-name"></div>
      <div class="doc-sub"><span>${d.pages || '—'} صفحة</span><span>${fmtSize(d.size)}</span></div>`;
    meta.querySelector('.doc-name').textContent = d.name.replace(/\.pdf$/i, '');

    const del = document.createElement('button');
    del.className = 'doc-del'; del.title = 'حذف';
    del.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2M8 7l1 13h6l1-13"/></svg>`;
    del.addEventListener('click', (e) => { e.stopPropagation(); removeDoc(d.id); });

    item.append(thumb, meta, del);
    item.addEventListener('click', () => openDoc(d.id));
    el.docList.appendChild(item);
  });

  el.libCount.textContent = state.docs.length
    ? `${state.docs.length} ملف في المكتبة`
    : 'لا توجد ملفات';
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1048576;
  if (mb >= 1) return mb.toFixed(1) + ' م.ب';
  return Math.max(1, Math.round(bytes / 1024)) + ' ك.ب';
}

/* ---------- فتح ملفات جديدة ---------- */
async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!files.length) { toast('الرجاء اختيار ملفات PDF'); return; }

  showLoader('جارٍ الاستيراد…');
  let first = null;
  const failed = [];
  try {
    for (const file of files) {
      try {
        const rec = {
          id: 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name: file.name,
          size: file.size,
          pages: 0,
          addedAt: Date.now(),
          lastOpenedAt: Date.now(),
          lastPage: 1,
          blob: file,
        };
        // عدّ الصفحات (غير حرج)
        try {
          const buf = await file.arrayBuffer();
          const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
          rec.pages = doc.numPages;
          doc.destroy();
        } catch { /* تجاهل */ }
        // الحفظ في المكتبة (غير حرج: نفتح الملف حتى لو تعذّر الحفظ)
        try { await putDoc(rec); } catch (e) { console.warn('storage unavailable', e); }
        if (!first) first = rec;
      } catch (e) {
        console.error(e);
        failed.push(file.name);
      }
    }

    try { await refreshLibrary(); } catch (e) { console.warn('storage unavailable', e); }

    if (first) await openDoc(first);
    else if (files.length) toast('تعذّر فتح الملف');
  } finally {
    hideLoader();
  }

  if (failed.length) toast('تعذّر فتح: ' + failed.join('، '));
}

async function removeDoc(id) {
  await deleteDoc(id);
  if (state.doc && state.doc.id === id) closeDoc();
  await refreshLibrary();
  toast('تم حذف الملف');
}

async function loadSample() {
  showLoader('جارٍ تحميل الملف التجريبي…');
  try {
    const res = await fetch(SAMPLE_URL, { mode: 'cors' });
    if (!res.ok) throw new Error('bad');
    const blob = await res.blob();
    const file = new File([blob], 'TraceMonkey — ملف تجريبي.pdf', { type: 'application/pdf' });
    await handleFiles([file]);
    toast('تمت إضافة الملف التجريبي');
  } catch {
    hideLoader();
    toast('تعذّر تحميل الملف التجريبي (تحقق من الاتصال)');
  }
}

/* ============================================================
   فتح مستند وبناء الصفحات
   ============================================================ */
async function openDoc(idOrRec) {
  const rec = typeof idOrRec === 'string' ? await getDoc(idOrRec).catch(() => null) : idOrRec;
  if (!rec) { toast('الملف غير موجود'); return; }
  showLoader('جارٍ فتح الملف…');
  let pdf = null;
  try {
    if (state.pdf) { try { state.pdf.destroy(); } catch {} }
    const buf = await rec.blob.arrayBuffer();
    pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    state.doc = rec;
    state.pdf = pdf;
    state.page = Math.min(rec.lastPage || 1, pdf.numPages);
    state.marks = await getMarksForDoc(rec.id).catch(() => []);

    // أبعاد الصفحات
    state.dims = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const v = p.getViewport({ scale: 1 });
      state.dims.push({ w: v.width, h: v.height });
    }
    // الصفحة الافتراضية للملاءمة
    if (!state.dims[0].w) throw new Error('empty');

    buildPages();
    applyDisplayMode();
    el.empty.hidden = true;
    el.pageBar.hidden = false;
    el.pageBar.classList.add('slide');
    updateHeader();
    updatePanel();
    updateMarkButton();

    await nextTick();
    layout(true);
    scrollToPage(state.page, false);
  } catch (err) {
    console.error(err);
    toast('تعذّر فتح هذا الملف');
  } finally {
    hideLoader();
  }

  // عمليات التخزين غير حرجة: التطبيق يعمل ويُعرض الملف حتى لو تعذّر الحفظ
  try {
    if (!rec.thumb && pdf) generateThumb(pdf, rec);
    rec.lastOpenedAt = Date.now();
    await putDoc(rec);
    await refreshLibrary();
  } catch (e) {
    console.warn('storage unavailable', e);
  }
}

function nextTick() { return new Promise((r) => requestAnimationFrame(() => r())); }

function buildPages() {
  el.pages.innerHTML = '';
  state.pageEls = [];
  state.gen++;
  for (let i = 0; i < state.dims.length; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.dataset.index = i;

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'page-canvas-wrap';

    const placeholder = document.createElement('div');
    placeholder.className = 'page-placeholder';
    placeholder.innerHTML = `<div class="spinner"></div>`;
    wrap.appendChild(placeholder);

    const hl = document.createElement('div');
    hl.className = 'hlLayer';

    const text = document.createElement('div');
    text.className = 'textLayer';

    wrap.append(canvasWrap, hl, text);
    el.pages.appendChild(wrap);

    wrap._canvasWrap = canvasWrap;
    wrap._hlLayer = hl;
    wrap._textLayer = text;
    wrap._placeholder = placeholder;
    state.pageEls.push(wrap);
  }
}

function pageScale(dim) {
  const availW = Math.max(240, el.stage.clientWidth - 52);
  const availH = Math.max(240, el.stage.clientHeight - 150);
  let base;
  if (state.fit === 'height') base = availH / dim.h;
  else base = availW / dim.w;
  return base * state.zoom;
}

/* ---------- التخطيط وإعادة الرسم ---------- */
function layout(rerender) {
  if (!state.pdf) return;
  const stageW = el.stage.clientWidth;
  state.pageEls.forEach((wrap, i) => {
    const dim = state.dims[i];
    const scale = pageScale(dim);
    const w = Math.round(dim.w * scale);
    const h = Math.round(dim.h * scale);
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    wrap.style.maxWidth = Math.min(w, stageW - 24) + 'px';
    if (rerender) { wrap._renderedGen = -1; }
  });
  updateZoomLabel();
  renderVisible();
}

function updateZoomLabel() {
  const dim = state.dims[0];
  if (!dim) return;
  const scale = pageScale(dim);
  el.zoomLabel.textContent = Math.round(scale * 100) + '%';
}

/* ---------- عرض الصفحات الظاهرة ---------- */
let observer = null;
function setupObserver() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const i = +entry.target.dataset.index;
        renderPage(i);
      }
    });
  }, { root: el.stage, rootMargin: '600px 0px' });
  state.pageEls.forEach((w) => observer.observe(w));
}
function renderVisible() {
  const top = el.stage.scrollTop;
  const bottom = top + el.stage.clientHeight;
  state.pageEls.forEach((wrap, i) => {
    const t = wrap.offsetTop, b = t + wrap.offsetHeight;
    if (b > top - 700 && t < bottom + 700) renderPage(i);
  });
}

function renderPage(index) {
  const wrap = state.pageEls[index];
  if (!wrap) return;
  const dim = state.dims[index];
  const scale = pageScale(dim);
  if (wrap._renderedGen === state.gen && wrap._renderedScale === scale) return;
  if (state.rendering.has(index)) return;
  state.rendering.add(index);

  const myGen = state.gen;
  (async () => {
    try {
      if (wrap._task) { try { wrap._task.cancel(); } catch {} wrap._task = null; }
      const pdfPage = await state.pdf.getPage(index + 1);
      if (myGen !== state.gen) return;

      const viewport = pdfPage.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let canvas = wrap._canvas;
      if (!canvas) {
        canvas = document.createElement('canvas');
        wrap._canvasWrap.appendChild(canvas);
        wrap._canvas = canvas;
      }
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = pdfPage.render({ canvasContext: ctx, viewport });
      wrap._task = task;
      await task.promise;
      if (myGen !== state.gen) return;

      wrap._renderedGen = state.gen;
      wrap._renderedScale = scale;
      if (wrap._placeholder) { wrap._placeholder.remove(); wrap._placeholder = null; }

      // طبقة النص للتحرير والتظليل
      await renderTextLayer(pdfPage, viewport, wrap);
      drawHighlights(index);
    } catch (e) {
      if (e && e.name !== 'RenderingCancelledException') console.error(e);
    } finally {
      state.rendering.delete(index);
    }
  })();
}

async function renderTextLayer(pdfPage, viewport, wrap) {
  try {
    const content = await pdfPage.getTextContent();
    const layer = wrap._textLayer;
    layer.innerHTML = '';
    layer.style.setProperty('--scale-factor', viewport.scale);
    const task = pdfjsLib.renderTextLayer({
      textContentSource: content,
      container: layer,
      viewport,
      textDivs: [],
    });
    await task.promise;
  } catch (e) { /* تجاهل أخطاء طبقة النص */ }
}

/* ============================================================
   التظليل والإشارات
   ============================================================ */
function drawHighlights(index) {
  const wrap = state.pageEls[index];
  if (!wrap) return;
  const layer = wrap._hlLayer;
  layer.innerHTML = '';
  const pageNum = index + 1;
  state.marks
    .filter((m) => m.type === 'highlight' && m.page === pageNum)
    .forEach((m) => {
      (m.rects || []).forEach((r) => {
        const d = document.createElement('div');
        d.className = 'hl';
        d.dataset.markId = m.id;
        d.style.background = HL_COLORS[m.color] || HL_COLORS.yellow;
        d.style.left = r.x * 100 + '%';
        d.style.top = r.y * 100 + '%';
        d.style.width = r.w * 100 + '%';
        d.style.height = r.h * 100 + '%';
        layer.appendChild(d);
      });
    });
}

function buildSwatches() {
  el.swatches.innerHTML = '';
  Object.entries(HL_COLORS).forEach(([key, color]) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (key === state.selColor ? ' sel' : '');
    b.style.background = color;
    b.dataset.color = key;
    b.title = 'تظليل';
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selColor = key;
      commitSelection();
    });
    el.swatches.appendChild(b);
  });
}

function handleSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { hideSelMenu(); return; }
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const pageEl = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.page');
  if (!pageEl) { hideSelMenu(); return; }
  const text = sel.toString().trim();
  if (!text) { hideSelMenu(); return; }

  const pageRect = pageEl.getBoundingClientRect();
  const rects = [...range.getClientRects()]
    .filter((r) => r.width > 0.6 && r.height > 0.6)
    .map((r) => ({
      x: Math.max(0, (r.left - pageRect.left) / pageRect.width),
      y: Math.max(0, (r.top - pageRect.top) / pageRect.height),
      w: Math.min(1, r.width / pageRect.width),
      h: Math.min(1, r.height / pageRect.height),
    }))
    .filter((r) => r.w > 0 && r.h > 0 && r.y < 1 && r.x < 1);

  if (!rects.length) { hideSelMenu(); return; }

  state.sel = { page: +pageEl.dataset.index + 1, rects, text: text.slice(0, 1200) };

  const box = range.getBoundingClientRect();
  const menuW = 220;
  let left = box.left + box.width / 2 - menuW / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - menuW - 10));
  let top = box.top - 56;
  if (top < 10) top = box.bottom + 10;
  el.selMenu.style.left = left + 'px';
  el.selMenu.style.top = top + 'px';
  el.selMenu.hidden = false;
}

function hideSelMenu() {
  el.selMenu.hidden = true;
  state.sel = null;
}

async function commitSelection() {
  const s = state.sel;
  if (!s) return;
  const mark = {
    id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    docId: state.doc.id,
    type: 'highlight',
    page: s.page,
    color: state.selColor,
    rects: s.rects,
    text: s.text,
    createdAt: Date.now(),
  };
  await putMark(mark);
  state.marks.push(mark);
  drawHighlights(s.page - 1);
  updatePanel();
  window.getSelection()?.removeAllRanges();
  hideSelMenu();
  toast('تم إضافة التظليل');
}

function pageBookmark() {
  const page = state.page;
  return state.marks.find((m) => m.type === 'bookmark' && m.page === page);
}

async function toggleBookmark() {
  if (!state.doc) return;
  const existing = pageBookmark();
  if (existing) {
    await deleteMark(existing.id);
    state.marks = state.marks.filter((m) => m.id !== existing.id);
    toast('أُزيلت الإشارة');
  } else {
    const mark = {
      id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      docId: state.doc.id,
      type: 'bookmark',
      page: state.page,
      createdAt: Date.now(),
    };
    await putMark(mark);
    state.marks.push(mark);
    toast('أُضيفت إشارة مرجعية');
  }
  updateMarkButton();
  updatePanel();
}

function updateMarkButton() {
  const bm = pageBookmark();
  el.bookmarkBtn.classList.toggle('on', !!bm);
  el.bookmarkBtn.style.color = bm ? '#ffd60a' : '';
}

/* ============================================================
   لوحة الإشارات
   ============================================================ */
let activeTab = 'bookmarks';
function updatePanel() {
  const body = el.panelBody;
  body.innerHTML = '';
  const markType = activeTab === 'bookmarks' ? 'bookmark' : 'highlight';
  const list = state.marks.filter((m) => m.type === markType);

  if (!state.doc) {
    body.innerHTML = `<div class="panel-empty">افتح ملفًا لعرض الإشارات والتظليل</div>`;
    return;
  }
  if (!list.length) {
    body.innerHTML = `<div class="panel-empty">${activeTab === 'bookmarks'
      ? 'لا توجد إشارات مرجعية بعد<br>اضغط أيقونة الإشارة لإضافة إشارة'
      : 'لا يوجد تظليل بعد<br>حدّد نصًا في الصفحة لتظليله'}</div>`;
    return;
  }

  list.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'mark-item';
    item.dataset.id = m.id;

    if (m.type === 'bookmark') {
      item.innerHTML = `<div class="mark-badge" style="color:#ffd60a">
          <svg viewBox="0 0 24 24"><path d="M6 4.5h12v15l-6-4-6 4v-15Z"/></svg></div>`;
    } else {
      item.innerHTML = `<div class="mark-badge" style="color:${HL_COLORS[m.color] || '#fff'}">
          <svg viewBox="0 0 24 24"><path d="M4 20h16M7 16l9-9-3-3-9 9v3h3Z"/></svg></div>`;
    }
    const bodyEl = document.createElement('div');
    bodyEl.className = 'mark-body';
    const title = document.createElement('div');
    title.className = 'mark-title';
    title.textContent = 'صفحة ' + m.page;
    bodyEl.appendChild(title);
    if (m.text) {
      const t = document.createElement('div');
      t.className = 'mark-text';
      t.textContent = m.text;
      bodyEl.appendChild(t);
    }
    const sub = document.createElement('div');
    sub.className = 'mark-sub';
    sub.textContent = new Date(m.createdAt).toLocaleDateString('ar', { day: 'numeric', month: 'short' });
    bodyEl.appendChild(sub);

    const del = document.createElement('button');
    del.className = 'mark-del'; del.title = 'حذف';
    del.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 7h12M9 7V5h6v2M8 7l1 13h6l1-13"/></svg>`;
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteMark(m.id);
      state.marks = state.marks.filter((x) => x.id !== m.id);
      drawHighlights(m.page - 1);
      updatePanel();
      updateMarkButton();
    });

    item.append(bodyEl, del);
    item.addEventListener('click', () => {
      scrollToPage(m.page, true);
      if (m.type === 'highlight') flashMark(m.id);
    });
    body.appendChild(item);
  });
}

function flashMark(id) {
  setTimeout(() => {
    document.querySelectorAll(`.hl[data-mark-id="${id}"]`).forEach((node) => {
      node.classList.add('flash');
      setTimeout(() => node.classList.remove('flash'), 1400);
    });
  }, 350);
}

/* ============================================================
   التنقل والتكبير
   ============================================================ */
function scrollToPage(n, smooth = true) {
  n = Math.max(1, Math.min(n, state.pageEls.length));
  const wrap = state.pageEls[n - 1];
  if (!wrap) return;
  const top = wrap.offsetTop - 14;
  el.stage.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  state.page = n;
  updateHeader();
}

function computeCurrentPage() {
  const center = el.stage.scrollTop + el.stage.clientHeight * 0.38;
  let best = 1, bestDist = Infinity;
  state.pageEls.forEach((wrap, i) => {
    const mid = wrap.offsetTop + wrap.offsetHeight / 2;
    const d = Math.abs(mid - center);
    if (d < bestDist) { bestDist = d; best = i + 1; }
  });
  return best;
}

function onScroll() {
  if (!state.pdf) return;
  const p = computeCurrentPage();
  if (p !== state.page) {
    state.page = p;
    updateHeader();
    updateMarkButton();
    if (state.doc) { state.doc.lastPage = p; }
  }
}

let scrollTick = false;
el.stage.addEventListener('scroll', () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => { scrollTick = false; onScroll(); });
});

function updateHeader() {
  if (!state.doc) {
    el.docTitle.textContent = 'اختر ملفًا للبدء';
    el.docSub.textContent = '—';
    return;
  }
  el.docTitle.textContent = state.doc.name.replace(/\.pdf$/i, '');
  el.docSub.textContent = `صفحة ${state.page} من ${state.pageEls.length}`;
  el.pageInput.value = state.page;
  el.pageTotal.textContent = '/ ' + state.pageEls.length;
}

function setZoom(z, absolute) {
  state.zoom = absolute ? z : Math.max(0.25, Math.min(5, state.zoom * z));
  state.zoom = Math.max(0.25, Math.min(5, state.zoom));
  savePrefs();
  layout(true);
}

/* ============================================================
   خلفية داكنة + وضع ليلي
   ============================================================ */
function applyDisplayMode() {
  const darkAmt = state.dark.on ? state.dark.intensity / 100 : 0;
  state.pageEls.forEach((wrap) => {
    wrap.classList.toggle('dark-mode', state.dark.on);
    if (wrap._canvasWrap) {
      if (state.dark.on) {
        const inv = 0.25 + darkAmt * 0.75; // لا نصل إلى انعكاس كامل حادّ دائمًا
        wrap._canvasWrap.style.filter =
          `invert(${inv.toFixed(2)}) hue-rotate(180deg) brightness(${(1 + (1 - darkAmt) * 0.06).toFixed(2)}) contrast(${(1 - darkAmt * 0.05).toFixed(2)})`;
      } else {
        wrap._canvasWrap.style.filter = '';
      }
    }
  });

  // وضع ليلي: دفء وخفوت عام على مساحة القراءة
  const warm = state.night.on ? state.night.warm / 100 : 0;
  el.stage.style.filter = state.night.on
    ? `sepia(${(warm * 0.5).toFixed(2)}) brightness(${(1 - warm * 0.22).toFixed(2)}) contrast(${(1 - warm * 0.05).toFixed(2)})`
    : '';

  el.darkPdfBtn.classList.toggle('on', state.dark.on);
  el.nightBtn.classList.toggle('on', state.night.on);
  el.comfort.hidden = !(state.dark.on || state.night.on) || state.comfortHidden;
  savePrefs();
}

/* ============================================================
   ربط الأحداث
   ============================================================ */
function bind() {
  el.sampleBtn.addEventListener('click', loadSample);

  // فتح الملفات عبر مُدخلات الملفات الأصلية (طبقة شفافة تغطّي الأزرار)
  el.fileInputs.forEach((inp) => {
    inp.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  });

  el.search.addEventListener('input', renderDocList);

  el.closeDocBtn.addEventListener('click', closeDoc);
  el.menuBtn.addEventListener('click', () => el.app.classList.add('side-open'));
  el.closeSidebar.addEventListener('click', () => el.app.classList.remove('side-open'));
  el.scrim.addEventListener('click', () => {
    el.app.classList.remove('side-open', 'panel-open');
  });

  el.prevBtn.addEventListener('click', () => scrollToPage(state.page - 1));
  el.nextBtn.addEventListener('click', () => scrollToPage(state.page + 1));
  el.pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') scrollToPage(parseInt(el.pageInput.value, 10) || 1);
  });
  el.pageInput.addEventListener('focus', () => el.pageInput.select());
  el.zoomInBtn.addEventListener('click', () => setZoom(1.15));
  el.zoomOutBtn.addEventListener('click', () => setZoom(1 / 1.15));
  el.zoomLabel.addEventListener('click', () => { state.zoom = 1; savePrefs(); layout(true); });

  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.fit = b.dataset.fit;
      state.zoom = 1;
      savePrefs();
      layout(true);
    });
  });

  el.darkPdfBtn.addEventListener('click', () => { state.dark.on = !state.dark.on; state.comfortHidden = false; applyDisplayMode(); });
  el.nightBtn.addEventListener('click', () => { state.night.on = !state.night.on; state.comfortHidden = false; applyDisplayMode(); });
  el.darkRange.addEventListener('input', () => { state.dark.intensity = +el.darkRange.value; applyDisplayMode(); });
  el.warmRange.addEventListener('input', () => { state.night.warm = +el.warmRange.value; applyDisplayMode(); });
  el.closeComfort.addEventListener('click', () => { state.comfortHidden = true; applyDisplayMode(); });

  el.bookmarkBtn.addEventListener('click', toggleBookmark);

  el.panelBtn.addEventListener('click', () => {
    el.app.classList.toggle('panel-open');
    el.scrim.hidden = !el.app.classList.contains('panel-open');
  });
  el.closePanel.addEventListener('click', () => { el.app.classList.remove('panel-open'); el.scrim.hidden = true; });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeTab = t.dataset.tab;
      updatePanel();
    });
  });

  el.smHighlight.addEventListener('click', () => commitSelection());
  el.smCopy.addEventListener('click', async () => {
    if (!state.sel) return;
    try { await navigator.clipboard.writeText(state.sel.text); toast('تم النسخ'); } catch {}
    window.getSelection()?.removeAllRanges();
    hideSelMenu();
  });

  // التحديد
  document.addEventListener('pointerup', (e) => {
    if (el.selMenu.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.topbar,.sidebar,.panel,.pagebar,.comfort')) return;
    setTimeout(handleSelection, 0);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!el.selMenu.hidden && !el.selMenu.contains(e.target)) hideSelMenu();
  });

  // السحب والإفلات
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++; el.stage.classList.add('dragover');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.stage.classList.remove('dragover'); } });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; el.stage.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });

  // لوحة المفاتيح
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    const k = e.key;
    if (k === 'PageDown' || k === 'j') { e.preventDefault(); scrollToPage(state.page + 1); }
    else if (k === 'PageUp' || k === 'k') { e.preventDefault(); scrollToPage(state.page - 1); }
    else if (k === 'Home') { e.preventDefault(); scrollToPage(1); }
    else if (k === 'End') { e.preventDefault(); scrollToPage(state.pageEls.length); }
    else if (k === '+' || k === '=') setZoom(1.15);
    else if (k === '-') setZoom(1 / 1.15);
    else if (k === 'd') { state.dark.on = !state.dark.on; applyDisplayMode(); }
    else if (k === 'n') { state.night.on = !state.night.on; applyDisplayMode(); }
    else if (k === 'b') toggleBookmark();
    else if (k === 'Escape') { hideSelMenu(); el.app.classList.remove('panel-open', 'side-open'); el.scrim.hidden = true; }
  });

  // تغيير الحجم
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (state.pdf) layout(true); }, 200);
  });

  window.addEventListener('beforeunload', () => {
    if (state.doc) { state.doc.lastPage = state.page; putDoc(state.doc).catch(() => {}); }
  });
}

/* ---------- إغلاق المستند ---------- */
function closeDoc() {
  if (state.pdf) { try { state.pdf.destroy(); } catch {} }
  if (state.doc) { state.doc.lastPage = state.page; putDoc(state.doc).catch(() => {}); }
  state.pdf = null; state.doc = null; state.pageEls = []; state.dims = [];
  state.marks = []; state.gen++;
  if (observer) { observer.disconnect(); observer = null; }
  el.pages.innerHTML = '';
  el.empty.hidden = false;
  el.pageBar.hidden = true;
  el.pageBar.classList.remove('slide');
  el.app.classList.remove('panel-open');
  el.scrim.hidden = true;
  state.page = 1;
  updateHeader();
  renderDocList();
}

/* ---------- صورة مصغّرة ---------- */
async function generateThumb(pdf, rec) {
  try {
    const page = await pdf.getPage(1);
    const v = page.getViewport({ scale: 1 });
    const tw = 120;
    const scale = tw / v.width;
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    rec.thumb = c.toDataURL('image/jpeg', 0.7);
    await putDoc(rec);
    refreshLibrary();
  } catch {}
}

/* ============================================================
   تشغيل
   ============================================================ */
async function init() {
  buildSwatches();

  // ضبط عناصر التحكم على القيم المحفوظة
  el.darkRange.value = state.dark.intensity;
  el.warmRange.value = state.night.warm;
  document.querySelectorAll('.seg-btn').forEach((x) => {
    x.classList.toggle('active', x.dataset.fit === state.fit);
  });

  applyDisplayMode();
  bind(); // اربط الواجهة أولًا حتى تبقى قابلة للاستخدام مهما حدث للتخزين
  window.__PDFREADER_READY__ = true; // أخبر شبكة الأمان أن التطبيق بدأ فعليًا

  try {
    await refreshLibrary();
  } catch (e) {
    console.warn('storage unavailable', e);
    el.docList.innerHTML = `<div class="lib-empty">تعذّر الوصول لذاكرة المتصفح.<br>يمكنك فتح الملفات وقراءتها الآن، لكن قد لا يُحفظ سجلّك.</div>`;
  }

  if (state.docs.length) {
    openDoc(state.docs[0].id);
  }
}

init();
})();
