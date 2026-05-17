import type { Schema } from "prosemirror-model";
import { Node } from "prosemirror-model";

const DB_NAME = "memos-editor-cache";
const DB_VERSION = 2;
const STORE_NAME = "parsed-docs";

interface CachedDoc {
  memoName: string;
  updateTime: string;
  json: Record<string, unknown>;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "memoName" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCached(memoName: string): Promise<CachedDoc | undefined> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(memoName);
      req.onsuccess = () => resolve(req.result as CachedDoc | undefined);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function setCached(entry: CachedDoc): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
  } catch {
    // silently ignore
  }
}

const WORKER_PARSE_TIMEOUT = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("parse worker timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function toTimestampKey(updateTime: unknown): string {
  if (!updateTime) return "";
  if (typeof updateTime === "string") return updateTime;
  if (updateTime instanceof Date) return updateTime.toISOString();
  if (typeof updateTime === "object" && "seconds" in updateTime) {
    const obj = updateTime as { seconds?: bigint | number; nanos?: number };
    return String(obj.seconds ?? 0) + "." + String(obj.nanos ?? 0);
  }
  return "";
}

let workerInstance: Worker | null = null;
let workerIdCounter = 0;
const workerCallbacks = new Map<
  string,
  {
    resolve: (json: Record<string, unknown>) => void;
    reject: (err: Error) => void;
  }
>();

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(new URL("./parseWorker.ts", import.meta.url), { type: "module" });
    workerInstance.onmessage = (e: MessageEvent<{ id: string; json?: Record<string, unknown>; error?: string }>) => {
      const cb = workerCallbacks.get(e.data.id);
      if (!cb) return;
      workerCallbacks.delete(e.data.id);
      if (e.data.error) {
        cb.reject(new Error(e.data.error));
      } else {
        cb.resolve(e.data.json!);
      }
    };
    workerInstance.onerror = (e) => {
      console.error("[parseWorker] Worker error:", e.message);
    };
  }
  return workerInstance;
}

export function parseInWorker(content: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = String(++workerIdCounter);
    workerCallbacks.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, content });
    } catch (err) {
      workerCallbacks.delete(id);
      reject(err);
    }
  });
}

export async function loadDoc(
  schema: Schema,
  parser: { parse(content: string): Node },
  memoName: string,
  updateTime: unknown,
  content: string,
): Promise<Node> {
  const ts = toTimestampKey(updateTime);

  // 1. Try IndexedDB cache
  console.time("[loadDoc] idb-get");
  const cached = await getCached(memoName);
  console.timeEnd("[loadDoc] idb-get");
  if (cached && cached.updateTime === ts) {
    try {
      console.time("[loadDoc] fromJSON-cached");
      const doc = Node.fromJSON(schema, cached.json);
      console.timeEnd("[loadDoc] fromJSON-cached");
      return doc;
    } catch {
      // cache invalid
    }
  }

  // 2. Parse in Web Worker (off main thread) - NO fallback to main thread parse
  console.time("[loadDoc] worker-parse");
  let json: Record<string, unknown>;
  try {
    json = await withTimeout(parseInWorker(content), WORKER_PARSE_TIMEOUT);
    console.timeEnd("[loadDoc] worker-parse");
  } catch (err) {
    console.timeEnd("[loadDoc] worker-parse");
    console.warn("[loadDoc] worker parse failed, falling back to main thread parser", err);
    const fallbackDoc = parser.parse(content);
    void setCached({ memoName, updateTime: ts, json: fallbackDoc.toJSON() });
    return fallbackDoc;
  }

  // 3. Cache (fire-and-forget)
  void setCached({ memoName, updateTime: ts, json });

  // 4. Build Node from JSON on main thread (fast ~ms)
  console.time("[loadDoc] fromJSON");
  const doc = Node.fromJSON(schema, json);
  console.timeEnd("[loadDoc] fromJSON");
  return doc;
}
