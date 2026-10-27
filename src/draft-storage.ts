import type { AppState } from './types'

type Draft = { base: AppState; state: AppState; deletedRoots?: string[] }
const keyName = 'funban-draft-tab'
let queue = Promise.resolve()

function tabKey() {
  try {
    let key = sessionStorage.getItem(keyName)
    if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(keyName, key) }
    return key
  } catch { return 'current' }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('funban-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest) {
  const db = await openDatabase()
  return new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction('drafts', mode)
    const request = operation(transaction.objectStore('drafts'))
    transaction.oncomplete = () => { db.close(); resolve(request.result) }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
    transaction.onabort = () => { db.close(); reject(transaction.error) }
  })
}

export async function readDraft(): Promise<Draft | null> {
  try { return (await transact('readonly', (store) => store.get(tabKey()))) as Draft | null ?? null }
  catch { return null }
}

export function saveDraft(draft: Draft) {
  queue = queue.then(async () => { await transact('readwrite', (store) => store.put(draft, tabKey())) }).catch(() => {})
}

export function clearDraft() {
  queue = queue.then(async () => { await transact('readwrite', (store) => store.delete(tabKey())) }).catch(() => {})
}
