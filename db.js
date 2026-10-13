// IndexedDB 저장소 — 데이터는 이 기기에만 저장되고 서버로 보내지 않는다.
import { TRASH_DAYS } from './calc.js';

const NAME = 'gulbi-ledger';
const VERSION = 1;
export const STORES = ['plan', 'entries', 'rewards', 'settings'];
export const BACKUP_APP = 'gulbi-ledger';
export const BACKUP_VERSION = 1;

let dbp;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('plan', { keyPath: 'id' });
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('rewards', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});

async function run(stores, mode, fn) {
  const db = await open();
  const tx = db.transaction(stores, mode);
  const out = fn(tx);
  await done(tx);
  return out;
}

export async function getAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const put = (store, value) => run([store], 'readwrite', tx => { tx.objectStore(store).put(value); });
export const del = (store, id) => run([store], 'readwrite', tx => { tx.objectStore(store).delete(id); });

export const replaceStore = (store, values) => run([store], 'readwrite', tx => {
  const os = tx.objectStore(store);
  os.clear();
  values.forEach(v => os.put(v));
});

export async function loadAll() {
  const [plan, entries, rewards, settingsRows] = await Promise.all(STORES.map(getAll));
  const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  return { plan, entries, rewards, settings };
}

export const saveSetting = (key, value) => put('settings', { key, value });

// 휴지통 정책: 삭제 후 30일이 지난 기록은 앱을 열 때 영구 삭제
export async function purgeTrash(entries, now = Date.now()) {
  const cutoff = now - TRASH_DAYS * 864e5;
  const old = entries.filter(e => e.deletedAt && Date.parse(e.deletedAt) < cutoff);
  if (old.length) await run(['entries'], 'readwrite', tx => old.forEach(e => tx.objectStore('entries').delete(e.id)));
  return old.map(e => e.id);
}

// 전체 교체(백업 불러오기·초기화): 한 트랜잭션으로 처리해 중간에 실패하면 아무것도 바뀌지 않는다
export async function replaceAll({ plan = [], entries = [], rewards = [], settings = {} }) {
  await run(STORES, 'readwrite', tx => {
    STORES.forEach(s => tx.objectStore(s).clear());
    plan.forEach(v => tx.objectStore('plan').put(v));
    entries.forEach(v => tx.objectStore('entries').put(v));
    rewards.forEach(v => tx.objectStore('rewards').put(v));
    Object.entries(settings).forEach(([key, value]) => tx.objectStore('settings').put({ key, value }));
  });
}

export function toBackup(state) {
  return {
    app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    plan: state.plan, entries: state.entries, rewards: state.rewards, settings: state.settings,
  };
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('백업 파일을 읽을 수 없어요'); }
  if (data?.app !== BACKUP_APP) throw new Error('굴비 가계부 백업 파일이 아니에요');
  if (data.version > BACKUP_VERSION) throw new Error('더 새 버전 앱에서 만든 백업이에요. 앱을 새로고침해주세요');
  for (const k of ['plan', 'entries', 'rewards']) if (!Array.isArray(data[k])) throw new Error('백업 파일이 손상됐어요');
  if (typeof data.settings !== 'object' || !data.settings) throw new Error('백업 파일이 손상됐어요');
  return data;
}

// 브라우저가 저장 공간 부족 시 데이터를 지우지 않도록 요청
export async function requestPersist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
