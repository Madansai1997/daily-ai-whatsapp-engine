/* Browser-side persistence for the Data Analyst "projects". Everything lives in IndexedDB, so a
 * project (a folder of datasets) survives refreshes and return visits WITHOUT anything ever leaving
 * the machine — no server, no OOM risk, free. We store each dataset's RAW uploaded bytes/text and
 * re-parse it into pandas on load, which is the most faithful + format-agnostic approach. */

const DB_NAME = "jarvis-analyst";
const DB_VERSION = 1;
const P_STORE = "projects";
const D_STORE = "datasets";

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
  await tx(D_STORE, "readwrite", (s) => s.put(full));
  const proj = await tx<ProjectRec | undefined>(P_STORE, "readonly", (s) => s.get(rec.projectId));
  if (proj) { proj.order = [...proj.order.filter((x) => x !== full.id), full.id]; await saveProject(proj); }
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
