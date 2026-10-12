// Exemplaire personnel du PDF : l'utilisateur l'associe une fois, il est
// conservé dans IndexedDB sur son appareil (jamais publié avec l'application,
// le dossier du magazine étant protégé par le droit d'auteur).

const DB = 'instant-critique-pdf';
const STORE = 'files';
const KEY = 'dossier';

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB indisponible'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

let url = null;

export async function initPdf() {
  try {
    const blob = await tx('readonly', (s) => s.get(KEY));
    if (blob) url = URL.createObjectURL(blob);
  } catch { url = null; }
  return !!url;
}

export async function savePdf(file) {
  await tx('readwrite', (s) => s.put(file, KEY));
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(file);
}

export async function removePdf() {
  await tx('readwrite', (s) => s.delete(KEY));
  if (url) URL.revokeObjectURL(url);
  url = null;
}

export const hasPdf = () => !!url;
export const pdfHref = (page) => (url ? `${url}#page=${page}` : null);
