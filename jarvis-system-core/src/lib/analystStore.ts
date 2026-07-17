/* Browser-side persistence for the Data Analyst "projects". Everything lives in IndexedDB, so a
 * project (a folder of datasets) survives refreshes and return visits WITHOUT anything ever leaving
 * the machine — no server, no OOM risk, free. We store each dataset's RAW uploaded bytes/text and
 * re-parse it into pandas on load, which is the most faithful + format-agnostic approach. */

const DB_NAME = "jarvis-analyst";
const DB_VERSION = 2;
const P_STORE = "projects";
const D_STORE = "datasets";
const T_STORE = "turns";

export interface ProjectRec {
  id: string;
  name: string;
  createdAt: number;
  order: string[]; // dataset ids, in display order
}
export interface DatasetRec {
  id: string;
  projectId: string;
  name: string;       // display / variable name (e.g. "sales")
  fileName: string;
  fmt: string;        // csv|tsv|json|xml|xlsx|xls|parquet|sqlite
  sheet: string;      // sheet/table name when applicable, else ""
  binary: boolean;
  content: ArrayBuffer | string; // raw uploaded bytes (binary) or text
  addedAt: number;
}

function uid(): string {
  return (crypto as { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let _dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(P_STORE)) d.createObjectStore(P_STORE, { keyPath: "id" });
      if (!d.objectStoreNames.contains(D_STORE)) {
        const s = d.createObjectStore(D_STORE, { keyPath: "id" });
        s.createIndex("projectId", "projectId", { unique: false });
      }
      if (!d.objectStoreNames.contains(T_STORE)) {
        const s = d.createObjectStore(T_STORE, { keyPath: "id" });
        s.createIndex("projectId", "projectId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }));
}

// ── projects ──────────────────────────────────────────────────────────────────
export async function listProjects(): Promise<ProjectRec[]> {
  const all = await tx<ProjectRec[]>(P_STORE, "readonly", (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}
export async function createProject(name: string): Promise<ProjectRec> {
  const rec: ProjectRec = { id: uid(), name: name.trim() || "Untitled project", createdAt: Date.now(), order: [] };
  await tx(P_STORE, "readwrite", (s) => s.put(rec));
  return rec;
}
export async function saveProject(rec: ProjectRec): Promise<void> {
  await tx(P_STORE, "readwrite", (s) => s.put(rec));
}
export async function deleteProject(id: string): Promise<void> {
  const datasets = await getDatasets(id);
  await Promise.all(datasets.map((d) => removeDataset(d.id)));
  await tx(P_STORE, "readwrite", (s) => s.delete(id));
}

// ── datasets ──────────────────────────────────────────────────────────────────
export async function getDatasets(projectId: string): Promise<DatasetRec[]> {
  const rows = await tx<DatasetRec[]>(D_STORE, "readonly", (s) => s.index("projectId").getAll(projectId));
  return rows;
}
export async function addDataset(rec: Omit<DatasetRec, "id" | "addedAt">): Promise<DatasetRec> {
  const full: DatasetRec = { ...rec, id: uid(), addedAt: Date.now() };
  const d = await db();
  // Put the dataset AND update the project's order in ONE transaction — a separate read-then-write
  // could lose the append under concurrent adds and orphan the dataset.
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction([D_STORE, P_STORE], "readwrite");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.objectStore(D_STORE).put(full);
    const pReq = t.objectStore(P_STORE).get(rec.projectId);
    pReq.onsuccess = () => {
      const proj = pReq.result as ProjectRec | undefined;
      if (proj) { proj.order = [...proj.order.filter((x) => x !== full.id), full.id]; t.objectStore(P_STORE).put(proj); }
    };
  });
  return full;
}
export async function removeDataset(id: string): Promise<void> {
  const rec = await tx<DatasetRec | undefined>(D_STORE, "readonly", (s) => s.get(id));
  await tx(D_STORE, "readwrite", (s) => s.delete(id));
  if (rec) {
    const proj = await tx<ProjectRec | undefined>(P_STORE, "readonly", (s) => s.get(rec.projectId));
    if (proj) { proj.order = proj.order.filter((x) => x !== id); await saveProject(proj); }
  }
}
export async function renameDataset(id: string, name: string): Promise<void> {
  const rec = await tx<DatasetRec | undefined>(D_STORE, "readonly", (s) => s.get(id));
  if (rec) { rec.name = name; await tx(D_STORE, "readwrite", (s) => s.put(rec)); }
}

// ── analysis history (turns) ──────────────────────────────────────────────────
// One row per answered question, persisted so a project's insights survive refresh. `data` is the
// JSON-serialized Turn (question, code, result, chart, image, brief). Pinned turns are kept; a cap
// of unpinned turns is pruned so stored size (base64 charts) stays bounded.
export interface TurnRec { id: string; projectId: string; ts: number; pinned: boolean; data: string; }
const UNPINNED_CAP = 25;

export async function getTurns(projectId: string): Promise<TurnRec[]> {
  const rows = await tx<TurnRec[]>(T_STORE, "readonly", (s) => s.index("projectId").getAll(projectId));
  return rows.sort((a, b) => a.ts - b.ts);
}
export async function saveTurn(projectId: string, id: string, data: unknown, pinned = false): Promise<void> {
  await tx(T_STORE, "readwrite", (s) => s.put({ id, projectId, ts: Date.now(), pinned, data: JSON.stringify(data) } as TurnRec));
  // prune oldest unpinned beyond the cap
  const all = await getTurns(projectId);
  const unpinned = all.filter((t) => !t.pinned);
  if (unpinned.length > UNPINNED_CAP) {
    const drop = unpinned.slice(0, unpinned.length - UNPINNED_CAP);
    await Promise.all(drop.map((t) => tx(T_STORE, "readwrite", (s) => s.delete(t.id))));
  }
}
export async function setTurnPinned(id: string, pinned: boolean): Promise<void> {
  const rec = await tx<TurnRec | undefined>(T_STORE, "readonly", (s) => s.get(id));
  if (rec) { rec.pinned = pinned; await tx(T_STORE, "readwrite", (s) => s.put(rec)); }
}
export async function deleteTurn(id: string): Promise<void> {
  await tx(T_STORE, "readwrite", (s) => s.delete(id));
}
