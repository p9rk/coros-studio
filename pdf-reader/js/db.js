/* تخزين محلي عبر IndexedDB: الملفات + الإشارات والتظليل */

const DB_NAME = 'pdf-reader-db';
const DB_VER = 1;
const STORE_DOCS = 'docs';
const STORE_MARKS = 'marks';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => fail(new Error('IndexedDB timeout')), 4000);
    function fail(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _dbPromise = null; // اسمح بمحاولة لاحقة
      reject(err || new Error('IndexedDB unavailable'));
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VER);
    } catch (e) { fail(e); return; }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MARKS)) {
        const s = db.createObjectStore(STORE_MARKS, { keyPath: 'id' });
        s.createIndex('docId', 'docId', { unique: false });
      }
    };
    req.onsuccess = () => {
      if (settled) { try { req.result.close(); } catch {} return; }
      settled = true;
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error('IndexedDB blocked'));
  });
  return _dbPromise;
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---------- documents ---------- */
export async function putDoc(doc) {
  const store = await tx(STORE_DOCS, 'readwrite');
  await wrap(store.put(doc));
  return doc;
}
export async function getDoc(id) {
  const store = await tx(STORE_DOCS, 'readonly');
  return wrap(store.get(id));
}
export async function getAllDocs() {
  const store = await tx(STORE_DOCS, 'readonly');
  const all = await wrap(store.getAll());
  return all.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
}
export async function deleteDoc(id) {
  const store = await tx(STORE_DOCS, 'readwrite');
  await wrap(store.delete(id));
  const marks = await getMarksForDoc(id);
  for (const m of marks) await deleteMark(m.id);
}

/* ---------- marks (bookmarks + highlights) ---------- */
export async function putMark(mark) {
  const store = await tx(STORE_MARKS, 'readwrite');
  await wrap(store.put(mark));
  return mark;
}
export async function deleteMark(id) {
  const store = await tx(STORE_MARKS, 'readwrite');
  return wrap(store.delete(id));
}
export async function getMarksForDoc(docId) {
  const store = await tx(STORE_MARKS, 'readonly');
  const idx = store.index('docId');
  const all = await wrap(idx.getAll(IDBKeyRange.only(docId)));
  return all.sort((a, b) => (a.page - b.page) || (a.createdAt - b.createdAt));
}
