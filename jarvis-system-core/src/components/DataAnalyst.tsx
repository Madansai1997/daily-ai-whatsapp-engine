import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  Upload, Table2, Send, Loader2, AlertTriangle, Code2, Sparkles, FileSpreadsheet,
  ClipboardList, Wand2, Lightbulb, Target, Database, RefreshCw, FolderPlus, Trash2,
  Link2, ChevronDown, Plus, X,
} from "lucide-react";
import {
  ProjectRec, DatasetRec, listProjects, createProject, deleteProject,
  getDatasets, addDataset, removeDataset,
} from "../lib/analystStore";

/* AI Data Analyst — a browser-native senior-analyst workspace. A PROJECT is a folder of datasets
 * (CSV/TSV/JSON/XML/Excel/Parquet/SQLite; multi-sheet workbooks and multi-table DBs load every
 * sheet/table as its own dataset). Everything — storage (IndexedDB), profiling, cleaning, the
 * pandas/matplotlib/scikit-learn you ask for — happens IN YOUR BROWSER (Pyodide via the engine's
 * same-origin proxy). JARVIS profiles every table, detects how they relate (candidate join keys),
 * and answers questions across them with a decision-ready Situation→Complication→Resolution brief. */

interface PyAPI {
  runPythonAsync: (code: string) => Promise<unknown>;
  loadPackage: (pkgs: string[], messageCallback?: (msg: string) => void) => Promise<void>;
  globals: { set: (k: string, v: unknown) => void };
}

let _py: Promise<PyAPI> | null = null;
const _loaded = new Set<string>(["pandas", "numpy"]);
function loadPy(onProgress?: (msg: string) => void): Promise<PyAPI> {
  if (_py) { if (onProgress) onProgress("Ready"); return _py; }
  // Same-origin: the engine proxies the Pyodide runtime from the CDN server-side (see
  // /pyodide/{path} in V3_updates.py), reliable even where jsdelivr is throttled.
  const base = "/pyodide/";
  _py = new Promise((resolve, reject) => {
    if (onProgress) onProgress("Connecting to Python runtime…");
    const s = document.createElement("script");
    s.src = `${base}pyodide.js`;
    s.onload = async () => {
      try {
        if (onProgress) onProgress("Initializing Python runtime…");
        const load = (window as unknown as { loadPyodide: (o: { indexURL: string }) => Promise<PyAPI> }).loadPyodide;
        const py = await load({ indexURL: base });
        if (onProgress) onProgress("Loading pandas & numpy (~20MB)…");
        await py.loadPackage(["pandas", "numpy"], (msg) => { if (onProgress) onProgress(msg); });
        resolve(py);
      } catch (e) { _py = null; reject(e); }
    };
    s.onerror = () => { _py = null; reject(new Error("Couldn't load the Python runtime.")); };
    document.head.appendChild(s);
  });
  return _py;
}
async function ensurePkgs(py: PyAPI, pkgs: string[]) {
  const need = pkgs.filter((p) => !_loaded.has(p));
  if (need.length) { await py.loadPackage(need); need.forEach((p) => _loaded.add(p)); }
}
// openpyxl isn't in Pyodide's loadPackage set — install the pure-Python wheel from our own origin.
async function ensureExcel(py: PyAPI, ext: string): Promise<string> {
  if (ext === "xls") { await ensurePkgs(py, ["xlrd"]); return "xlrd"; }
  if (!_loaded.has("openpyxl")) {
    await ensurePkgs(py, ["micropip"]);
    await py.runPythonAsync(
      "import micropip\n" +
      "await micropip.install(['/console/wheels/et_xmlfile-2.0.0-py3-none-any.whl', " +
      "'/console/wheels/openpyxl-3.1.5-py2.py3-none-any.whl'], deps=False)"
    );
    _loaded.add("openpyxl");
  }
  return "openpyxl";
}
// Heavy packages the generated code may reference — loaded on demand via the same-origin proxy.
function pkgsForCode(code: string): string[] {
  const c = code.toLowerCase();
  const need = ["matplotlib"];
  if (c.includes("sklearn") || c.includes("scikit")) need.push("scikit-learn");
  if (c.includes("scipy")) need.push("scipy");
  if (c.includes("statsmodels")) need.push("statsmodels");
  return need;
}

// ── format dispatch ──────────────────────────────────────────────────────────
interface Fmt { fmt: string; binary: boolean; }
function detectFmt(name: string): Fmt | null {
  const ext = (name.toLowerCase().split(".").pop() || "");
  switch (ext) {
    case "csv": return { fmt: "csv", binary: false };
    case "tsv": case "tab": return { fmt: "tsv", binary: false };
    case "json": return { fmt: "json", binary: false };
    case "xml": return { fmt: "xml", binary: true }; // read as bytes to preserve encoding
    case "parquet": return { fmt: "parquet", binary: true };
    case "xlsx": case "xls": return { fmt: ext, binary: true };
    case "db": case "sqlite": case "sqlite3": return { fmt: "sqlite", binary: true };
    default: return null;
  }
}
const MAX_BYTES = 15 * 1024 * 1024;
const baseName = (f: string) => f.replace(/\.[^.]+$/, "").trim() || "data";

const CYAN = "#8aebff", GREEN = "#5eead4", AMBER = "#ffd6a3", PURPLE = "#c084fc", MUTED = "#859397";
const PIE_COLORS = [CYAN, GREEN, AMBER, PURPLE, "#a3e635", "#ffb4ab", "#22d3ee", "#f0abfc"];
const tip = { background: "#0f131f", border: "1px solid #3c494c", borderRadius: 8, fontFamily: "monospace", fontSize: 12, color: "#dfe2f3" };
const JSON_HEADERS = { "Content-Type": "application/json" };

// ── Python snippets (run client-side; NOT the LLM-generated code) ─────────────
// Ingest one uploaded file into the DATASETS registry. Multi-sheet workbooks / multi-table DBs
// each add one dataset per sheet/table (named by sheet/table, deduped).
const INGEST_PY = `
import json as _json, io as _io
import pandas as pd, numpy as np
try: DATASETS
except NameError: DATASETS = {}
_fmt = fmt; _base = ds_base
def _b(): return bytes(src_bytes.to_py())
def _uniq(nm):
    nm = str(nm).strip() or 'data'; base = nm; i = 2
    while nm in DATASETS: nm = base + '_' + str(i); i += 1
    return nm
_added = []
def _finish(nm, d):
    d.columns = [str(c) for c in d.columns]
    for _c in d.columns:
        if d[_c].dtype == object:
            _s = d[_c].dropna().astype(str).head(20)
            if len(_s) and _s.str.match(r'^\\d{4}-\\d{2}-\\d{2}').mean() > 0.7:
                try: d[_c] = pd.to_datetime(d[_c], errors='coerce')
                except Exception: pass
    key = _uniq(nm); DATASETS[key] = d
    _added.append({"name": key, "nrows": int(len(d)), "ncols": int(len(d.columns))})
if _fmt in ('csv','tsv'):
    _finish(_base, pd.read_csv(_io.StringIO(src_text), sep='\\t' if _fmt=='tsv' else ','))
elif _fmt=='json':
    try: _df = pd.read_json(_io.StringIO(src_text))
    except Exception:
        import json as __j; _df = pd.json_normalize(__j.loads(src_text))
    _finish(_base, _df)
elif _fmt=='xml':
    _finish(_base, pd.read_xml(_io.BytesIO(_b())))
elif _fmt=='parquet':
    _finish(_base, pd.read_parquet(_io.BytesIO(_b()), engine='fastparquet'))
elif _fmt in ('xlsx','xls'):
    _sheets = pd.read_excel(_io.BytesIO(_b()), engine=excel_engine, sheet_name=None)
    _multi = len(_sheets) > 1
    for _sn, _sdf in _sheets.items(): _finish(_sn if _multi else _base, _sdf)
elif _fmt=='sqlite':
    import sqlite3
    with open('/tmp/_up.db','wb') as _f: _f.write(_b())
    _con = sqlite3.connect('/tmp/_up.db')
    _tabs = [r[0] for r in _con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
    if not _tabs: raise ValueError('No tables in this SQLite database.')
    _multi = len(_tabs) > 1
    for _t in _tabs: _finish(_t if _multi else _base, pd.read_sql('SELECT * FROM "%s"' % _t, _con))
else:
    raise ValueError('Unsupported format: ' + str(_fmt))
_json.dumps({"added": _added})
`;

const RESET_PY = `
try: DATASETS.clear()
except NameError: DATASETS = {}
'ok'
`;
const REMOVE_PY = `
import json as _json
try:
    for _n in _json.loads(remove_names): DATASETS.pop(_n, None)
except NameError: pass
'ok'
`;

// Profile every dataset + detect candidate join keys (value overlap / matching names) across them.
const PROFILE_ALL_PY = `
import json as _json, itertools as _it
import pandas as pd, numpy as np
try: DATASETS
except NameError: DATASETS = {}

def _profile_one(name, d):
    n = int(len(d)); cols = []; lines = []
    for c in d.columns:
        s = d[c]; miss = float(s.isna().mean()*100.0); nun = int(s.nunique(dropna=True))
        col = {"name": str(c), "dtype": str(s.dtype), "missing_pct": round(miss,1), "nunique": nun}
        if pd.api.types.is_numeric_dtype(s):
            col["kind"]="numeric"; sv = s.dropna().astype(float)
            if len(sv):
                q1=float(sv.quantile(.25)); q3=float(sv.quantile(.75)); iqr=q3-q1
                out=int(((sv<q1-1.5*iqr)|(sv>q3+1.5*iqr)).sum()) if iqr>0 else 0
                col.update({"mean":round(float(sv.mean()),3),"median":round(float(sv.median()),3),
                    "std":round(float(sv.std()),3) if len(sv)>1 else 0.0,"min":round(float(sv.min()),3),
                    "max":round(float(sv.max()),3),"skew":round(float(sv.skew()),3) if len(sv)>2 else 0.0,
                    "kurtosis":round(float(sv.kurtosis()),3) if len(sv)>3 else 0.0,"outliers":out})
                lines.append("- %s (%s) - %s%% missing; mean %s, median %s, std %s, min %s, max %s, skew %s, %d IQR outliers" % (c, s.dtype, round(miss,1), col['mean'], col['median'], col['std'], col['min'], col['max'], col['skew'], out))
            else: lines.append("- %s (%s) - all missing" % (c, s.dtype))
        elif pd.api.types.is_datetime64_any_dtype(s):
            col["kind"]="datetime"; sv=s.dropna()
            if len(sv):
                col["min"]=str(sv.min())[:19]; col["max"]=str(sv.max())[:19]
                lines.append("- %s (datetime) - %s%% missing; range %s to %s" % (c, round(miss,1), col['min'], col['max']))
            else: lines.append("- %s (datetime) - all missing" % c)
        else:
            col["kind"]="categorical" if nun<=max(30, n*0.5) else "text"
            vc = s.dropna().astype(str).value_counts().head(5)
            col["top"]=[{"value":str(k)[:40],"count":int(v)} for k,v in vc.items()]
            _t = ", ".join(d2["value"]+"("+str(d2["count"])+")" for d2 in col["top"][:3])
            lines.append("- %s (%s) - %s%% missing, %d unique; top: %s" % (c, s.dtype, round(miss,1), nun, _t))
        cols.append(col)
    return {"name":name,"nrows":n,"ncols":int(len(d.columns)),"columns":cols}, lines

def _sig(nm, c):
    try: vals = DATASETS[nm][c].dropna().astype(str).unique()
    except Exception: return None
    if len(vals) > 4000: vals = vals[:4000]
    return set(vals.tolist())

def _relationships():
    names = list(DATASETS.keys()); sigs = {}
    for nm in names:
        for c in DATASETS[nm].columns:
            sg = _sig(nm, c)
            if sg is not None and len(sg) >= 2: sigs[(nm, str(c))] = sg
    out = []
    for a, b in _it.combinations(names, 2):
        best = None
        for ca in DATASETS[a].columns:
            sa = sigs.get((a, str(ca)))
            if not sa: continue
            for cb in DATASETS[b].columns:
                sb = sigs.get((b, str(cb)))
                if not sb: continue
                ov = len(sa & sb) / min(len(sa), len(sb))
                nm_match = str(ca).lower() == str(cb).lower()
                score = ov + (0.15 if nm_match else 0.0)
                if (nm_match and ov >= 0.3) or ov >= 0.6:
                    if best is None or score > best["_s"]:
                        best = {"left":a,"leftCol":str(ca),"right":b,"rightCol":str(cb),"overlap":round(float(ov),2),"_s":score}
        if best: best.pop("_s"); out.append(best)
    out.sort(key=lambda r: -r["overlap"])
    return out[:8]

_dsets=[]; _lines=["PROJECT with %d dataset(s)." % len(DATASETS)]
for _nm, _d in DATASETS.items():
    _p, _pl = _profile_one(_nm, _d); _dsets.append(_p)
    _lines.append(""); _lines.append('DATASET "%s" - %d rows x %d columns.' % (_nm, _p["nrows"], _p["ncols"]))
    _lines.append("Columns:"); _lines.extend(_pl)
_rel = _relationships()
if _rel:
    _lines.append(""); _lines.append("RELATIONSHIPS (candidate join keys):")
    for r in _rel: _lines.append("- %s.%s <-> %s.%s (overlap %s)" % (r["left"], r["leftCol"], r["right"], r["rightCol"], r["overlap"]))
_json.dumps({"datasets":_dsets,"relationships":_rel,"profileText":"\\n".join(_lines)})
`;

const CLEAN_PY = `
import json as _json
import pandas as pd, numpy as np
df = DATASETS[clean_name]
_report = []
for _c in list(df.columns):
    _s = df[_c]
    if _s.dtype == object:
        _cl = _s.astype(str).str.strip().str.replace(r'\\s+', ' ', regex=True)
        _cl = _cl.replace({'nan': np.nan, 'None': np.nan, 'NaN': np.nan, '': np.nan})
        _nf = int(_cl.isna().sum()); df[_c] = _cl.fillna('Unknown')
        if _nf: _report.append(_c + ": filled " + str(_nf) + " missing with 'Unknown'")
    elif pd.api.types.is_numeric_dtype(_s):
        _m = int(_s.isna().sum())
        if _m: df[_c] = _s.fillna(_s.median()); _report.append(_c + ": imputed " + str(_m) + " missing with median")
_before = len(df); df.drop_duplicates(inplace=True); _drop = _before - len(df)
if _drop: _report.append("removed " + str(_drop) + " duplicate rows")
DATASETS[clean_name] = df
if not _report: _report.append("Already clean - no missing values, whitespace issues or duplicates found.")
_json.dumps(_report)
`;

const RUNNER_HEAD = `
import json as _json, io as _io, base64 as _b64
import pandas as pd, numpy as np
import matplotlib
matplotlib.use('AGG')
import matplotlib.pyplot as plt
plt.close('all')
try: DATASETS
except NameError: DATASETS = {}
datasets = DATASETS
df = next(iter(DATASETS.values())) if len(DATASETS) == 1 else None
result = None
`;
const RUNNER_TAIL = `
_img = None
try:
    if plt.get_fignums():
        _buf = _io.BytesIO()
        plt.gcf().savefig(_buf, format='png', dpi=110, bbox_inches='tight', facecolor='white')
        _img = _b64.b64encode(_buf.getvalue()).decode()
except Exception:
    _img = None
plt.close('all')
def _ser(r):
    try:
        if r is None: return {"kind":"none"}
        if isinstance(r, pd.DataFrame):
            _d = r.head(50)
            return {"kind":"table","columns":[str(c) for c in _d.columns],"rows":_json.loads(_d.to_json(orient="records"))}
        if isinstance(r, pd.Series):
            _d = r.head(50).reset_index(); _d.columns=[str(c) for c in _d.columns]
            return {"kind":"table","columns":list(_d.columns),"rows":_json.loads(_d.to_json(orient="records"))}
        if isinstance(r,(np.integer,)): r=int(r)
        elif isinstance(r,(np.floating,)): r=float(r)
        return {"kind":"scalar","value": r if isinstance(r,(int,float,str,bool)) else str(r)}
    except Exception as _e:
        return {"kind":"error","error":str(_e)}
_json.dumps({"result": _ser(result), "image": _img})
`;

// ── types ────────────────────────────────────────────────────────────────────
interface ColProfile {
  name: string; dtype: string; missing_pct: number; nunique: number;
  kind: "numeric" | "datetime" | "categorical" | "text";
  mean?: number; median?: number; std?: number; min?: number | string; max?: number | string;
  skew?: number; kurtosis?: number; outliers?: number;
  top?: { value: string; count: number }[];
}
interface DatasetProfile { name: string; nrows: number; ncols: number; columns: ColProfile[]; }
interface Relationship { left: string; leftCol: string; right: string; rightCol: string; overlap: number; }
interface ProfileAll { datasets: DatasetProfile[]; relationships: Relationship[]; profileText: string; }
interface Recon { read: string; hypotheses: string[]; kpis: { name: string; why: string }[]; questions: string[]; }
interface Chart { type: "bar" | "line" | "pie"; x: string; y: string; }
interface Scr { scorecard: string[]; descriptive: string; diagnostic: string; prescriptive: string; }
type RunResult =
  | { kind: "table"; columns: string[]; rows: Record<string, unknown>[] }
  | { kind: "scalar"; value: unknown }
  | { kind: "none" };
interface Turn {
  id: string; q: string;
  code?: string; explanation?: string; chart?: Chart | null; image?: string | null;
  result?: RunResult; scr?: Scr | null; scrLoading?: boolean;
  error?: string; running?: boolean; retried?: boolean;
}
interface LoadedFile { rec: DatasetRec; names: string[]; }

interface CodeGen { code: string; explanation: string; chart: Chart | null; error?: string; }
async function fetchCode(question: string, schema: string, previous_code?: string, error?: string): Promise<CodeGen> {
  const res = await fetch("/api/analyst/code", {
    method: "POST", headers: JSON_HEADERS,
    body: JSON.stringify({ question, schema, previous_code, error }),
  });
  const d = await res.json();
  if (!res.ok || d.error) return { code: "", explanation: "", chart: null, error: d.error || `Request failed (${res.status}).` };
  const chart = d.chart && ["bar", "line", "pie"].includes(d.chart.type) ? (d.chart as Chart) : null;
  return { code: d.code, explanation: (d.explanation || "").trim(), chart };
}
async function runGenerated(py: PyAPI, code: string): Promise<{ ok: boolean; result?: RunResult; image?: string | null; error?: string }> {
  try {
    const out = await py.runPythonAsync(`${RUNNER_HEAD}\n${code}\n${RUNNER_TAIL}`);
    const parsed = JSON.parse(out as string) as { result: RunResult | { kind: "error"; error: string }; image: string | null };
    if ((parsed.result as { kind: string }).kind === "error") return { ok: false, error: (parsed.result as { error: string }).error };
    return { ok: true, result: parsed.result as RunResult, image: parsed.image };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
function resultToText(result?: RunResult, image?: string | null): string {
  if (!result || result.kind === "none") return image ? "(a chart was produced from the data)" : "(no tabular result)";
  if (result.kind === "scalar") return `Result value: ${String(result.value)}`;
  const head = result.columns.join(" | ");
  const body = result.rows.slice(0, 20).map((r) => result.columns.map((c) => fmt(r[c])).join(" | ")).join("\n");
  return `Columns: ${head}\n${body}\n(${result.rows.length} rows)`;
}

// Set the ingest globals for one file and run INGEST_PY; returns the dataset names it created.
async function ingestFile(py: PyAPI, rec: { fmt: string; binary: boolean; base: string; content: ArrayBuffer | string }): Promise<string[]> {
  let excelEngine = "openpyxl";
  if (rec.fmt === "xlsx" || rec.fmt === "xls") excelEngine = await ensureExcel(py, rec.fmt);
  else if (rec.fmt === "parquet") await ensurePkgs(py, ["fastparquet"]);
  else if (rec.fmt === "xml") await ensurePkgs(py, ["lxml"]);
  py.globals.set("fmt", rec.fmt);
  py.globals.set("ds_base", rec.base);
  py.globals.set("excel_engine", excelEngine);
  if (rec.binary) py.globals.set("src_bytes", new Uint8Array(rec.content as ArrayBuffer));
  else py.globals.set("src_text", rec.content as string);
  const out = JSON.parse((await py.runPythonAsync(INGEST_PY)) as string) as { added: { name: string }[] };
  return out.added.map((a) => a.name);
}

export default function DataAnalyst() {
  const [pyState, setPyState] = useState<"loading" | "ready" | "error">("loading");
  const [projects, setProjects] = useState<ProjectRec[]>([]);
  const [project, setProject] = useState<ProjectRec | null>(null);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [prof, setProf] = useState<ProfileAll | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [busyLoad, setBusyLoad] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [projMenu, setProjMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Prefetch the runtime on mount (one-time ~20MB, cached) so uploads land straight on profiling.
  useEffect(() => {
    let alive = true;
    loadPy().then(() => { if (alive) setPyState("ready"); }).catch(() => { if (alive) setPyState("error"); });
    return () => { alive = false; };
  }, []);

  const loadRecon = useCallback(async (profileText: string) => {
    setRecon(null); setReconLoading(true);
    try {
      const r = await fetch("/api/analyst/hypotheses", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ profile: profileText }) });
      const d = await r.json();
      if (r.ok && !d.error) setRecon(d);
    } catch { /* best-effort */ } finally { setReconLoading(false); }
  }, []);

  const reprofile = useCallback(async (): Promise<ProfileAll | null> => {
    const py = await loadPy();
    const p = JSON.parse((await py.runPythonAsync(PROFILE_ALL_PY)) as string) as ProfileAll;
    setProf(p);
    return p;
  }, []);

  // Load a project: reset the registry, re-ingest its files, profile everything, refresh the read.
  const openProject = useCallback(async (p: ProjectRec) => {
    setProject(p); setBusyLoad(true); setError(""); setTurns([]); setProf(null); setRecon(null); setExpanded(null);
    try {
      setStatusMsg("Loading runtime…");
      const py = await loadPy((m) => setStatusMsg(m));
      await py.runPythonAsync(RESET_PY);
      const recs = await getDatasets(p.id);
      const ordered = p.order.length ? p.order.map((id) => recs.find((r) => r.id === id)).filter(Boolean) as DatasetRec[] : recs;
      const loaded: LoadedFile[] = [];
      for (const rec of ordered) {
        setStatusMsg(`Loading ${rec.fileName}…`);
        const names = await ingestFile(py, { fmt: rec.fmt, binary: rec.binary, base: rec.name, content: rec.content });
        loaded.push({ rec, names });
      }
      setFiles(loaded);
      if (loaded.length) { const p2 = await reprofile(); if (p2) loadRecon(p2.profileText); }
      else setProf(null);
    } catch (e) {
      setError(`Couldn't load the project: ${e instanceof Error ? e.message : e}`);
    } finally { setBusyLoad(false); setStatusMsg(""); }
  }, [reprofile, loadRecon]);

  // First mount: load (or create) the project list and open the first.
  useEffect(() => {
    (async () => {
      let ps = await listProjects();
      if (!ps.length) { const p = await createProject("My first project"); ps = [p]; }
      setProjects(ps);
      await openProject(ps[0]);
    })().catch((e) => setError(`Storage error: ${e instanceof Error ? e.message : e}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback(async (fileList: FileList) => {
    if (!project) return;
    setError(""); setBusyLoad(true);
    try {
      const py = await loadPy((m) => setStatusMsg(m));
      const newlyLoaded: LoadedFile[] = [];
      for (const file of Array.from(fileList)) {
        const det = detectFmt(file.name);
        if (!det) { setError(`Unsupported: ${file.name}. Use CSV/TSV/JSON/XML/Excel/Parquet/SQLite.`); continue; }
        if (file.size > MAX_BYTES) { setError(`${file.name} is too large (max 15MB).`); continue; }
        setStatusMsg(`Reading ${file.name}…`);
        const content: ArrayBuffer | string = det.binary ? await file.arrayBuffer() : await file.text();
        const names = await ingestFile(py, { fmt: det.fmt, binary: det.binary, base: baseName(file.name), content });
        const rec = await addDataset({ projectId: project.id, name: baseName(file.name), fileName: file.name, fmt: det.fmt, sheet: "", binary: det.binary, content });
        newlyLoaded.push({ rec, names });
      }
      if (newlyLoaded.length) {
        setFiles((f) => [...f, ...newlyLoaded]);
        const p2 = await reprofile();
        // refresh the project record's order from storage
        const ps = await listProjects(); setProjects(ps);
        const cur = ps.find((x) => x.id === project.id); if (cur) setProject(cur);
        if (p2) loadRecon(p2.profileText);
      }
    } catch (e) {
      setError(`Couldn't add data: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusyLoad(false); setStatusMsg("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [project, reprofile, loadRecon]);

  const removeFile = useCallback(async (lf: LoadedFile) => {
    if (!project) return;
    try {
      const py = await loadPy();
      py.globals.set("remove_names", JSON.stringify(lf.names));
      await py.runPythonAsync(REMOVE_PY);
      await removeDataset(lf.rec.id);
      const rest = files.filter((f) => f.rec.id !== lf.rec.id);
      setFiles(rest);
      setTurns([]);
      if (rest.length) { const p2 = await reprofile(); if (p2) loadRecon(p2.profileText); }
      else { setProf(null); setRecon(null); }
      const ps = await listProjects(); setProjects(ps);
    } catch (e) { setError(`Couldn't remove: ${e instanceof Error ? e.message : e}`); }
  }, [project, files, reprofile, loadRecon]);

  const runClean = useCallback(async (name: string) => {
    setCleaning(name);
    try {
      const py = await loadPy();
      py.globals.set("clean_name", name);
      await py.runPythonAsync(CLEAN_PY);
      const p2 = await reprofile(); if (p2) loadRecon(p2.profileText);
    } catch (e) { setError(`Clean failed: ${e instanceof Error ? e.message : e}`); }
    finally { setCleaning(""); }
  }, [reprofile, loadRecon]);

  const newProject = useCallback(async () => {
    const name = window.prompt("Name this project", "New project");
    if (name === null) return;
    const p = await createProject(name || "New project");
    setProjects((ps) => [...ps, p]); setProjMenu(false);
    await openProject(p);
  }, [openProject]);

  const removeProject = useCallback(async (p: ProjectRec) => {
    if (!window.confirm(`Delete project "${p.name}" and all its datasets?`)) return;
    await deleteProject(p.id);
    let ps = await listProjects();
    if (!ps.length) { ps = [await createProject("My first project")]; }
    setProjects(ps); setProjMenu(false);
    await openProject(ps[0]);
  }, [openProject]);

  const ask = useCallback(async (preset?: string) => {
    const q = (preset ?? question).trim();
    if (!q || !prof || busy) return;
    if (!preset) setQuestion("");
    setBusy(true);
    const id = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? String(Date.now() + Math.random());
    setTurns((t) => [...t, { id, q, running: true }]);
    const patch = (p: Partial<Turn>) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const schema = prof.profileText;
    try {
      const py = await loadPy();
      const gen = await fetchCode(q, schema);
      if (gen.error) { patch({ running: false, error: gen.error }); return; }
      await ensurePkgs(py, pkgsForCode(gen.code));
      let run = await runGenerated(py, gen.code);
      let usedCode = gen.code, usedExpl = gen.explanation, usedChart = gen.chart, retried = false;
      if (!run.ok) {
        const gen2 = await fetchCode(q, schema, gen.code, run.error);
        if (!gen2.error) {
          await ensurePkgs(py, pkgsForCode(gen2.code));
          const run2 = await runGenerated(py, gen2.code);
          if (run2.ok) { run = run2; usedCode = gen2.code; usedExpl = gen2.explanation; usedChart = gen2.chart; retried = true; }
          else { patch({ running: false, code: gen2.code, explanation: gen2.explanation, error: run2.error, retried: true }); return; }
        } else { patch({ running: false, code: gen.code, explanation: gen.explanation, error: run.error }); return; }
      }
      patch({ running: false, code: usedCode, explanation: usedExpl, chart: usedChart, result: run.result, image: run.image, retried, scrLoading: true });
      try {
        const r = await fetch("/api/analyst/synthesis", {
          method: "POST", headers: JSON_HEADERS,
          body: JSON.stringify({ question: q, result: resultToText(run.result, run.image) }),
        });
        const d = await r.json();
        if (r.ok && !d.error && (d.descriptive || (d.scorecard && d.scorecard.length))) patch({ scr: d, scrLoading: false });
        else patch({ scrLoading: false });
      } catch { patch({ scrLoading: false }); }
    } catch (e) {
      patch({ running: false, error: `Couldn't run the analysis: ${e instanceof Error ? e.message : e}` });
    } finally { setBusy(false); }
  }, [question, prof, busy]);

  const profByName = (n: string) => prof?.datasets.find((d) => d.name === n) || null;
  const totalDatasets = files.reduce((a, f) => a + f.names.length, 0);

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.4 }} className="space-y-6">
      {/* Header */}
      <section className="pt-4 flex flex-col md:flex-row justify-between md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
            <span className="opacity-40 font-light text-xl">04 //</span> DATA ANALYST
          </h1>
          <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
            A project of datasets · joined, profiled, questioned & briefed — in your browser
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Project switcher */}
          <div className="relative">
            <button onClick={() => setProjMenu((v) => !v)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold font-mono border border-white/10 bg-white/5 text-[#bbc9cd] hover:bg-white/10 transition-all cursor-pointer max-w-[220px]">
              <Database className="w-4 h-4 shrink-0 text-[#8aebff]" />
              <span className="truncate">{project?.name || "Project"}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
            </button>
            {projMenu && (
              <div className="absolute right-0 mt-2 w-64 z-30 rounded-xl border border-white/10 bg-[#0f131f] shadow-2xl p-1.5">
                {projects.map((p) => (
                  <div key={p.id} className={`flex items-center gap-1 rounded-lg ${p.id === project?.id ? "bg-[#8aebff]/10" : "hover:bg-white/5"}`}>
                    <button onClick={() => { setProjMenu(false); if (p.id !== project?.id) openProject(p); }}
                      className="flex-1 text-left px-3 py-2 text-[12px] font-mono text-[#dfe2f3] truncate cursor-pointer">{p.name}</button>
                    <button onClick={() => removeProject(p)} title="Delete project"
                      className="p-1.5 text-[#5c6a6d] hover:text-[#ffb4ab] cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <button onClick={newProject} className="w-full flex items-center gap-2 px-3 py-2 mt-1 rounded-lg text-[12px] font-mono text-[#8aebff] hover:bg-[#8aebff]/10 cursor-pointer border-t border-white/5">
                  <FolderPlus className="w-3.5 h-3.5" /> New project
                </button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" multiple accept=".csv,.tsv,.tab,.json,.xml,.parquet,.xlsx,.xls,.db,.sqlite,.sqlite3" className="hidden"
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); }} />
          <button onClick={() => fileRef.current?.click()} disabled={busyLoad || pyState === "error"}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold font-mono border border-[#8aebff]/30 bg-[#8aebff]/10 text-[#8aebff] hover:bg-[#8aebff]/20 transition-all cursor-pointer disabled:opacity-50">
            {busyLoad ? <><Loader2 className="w-4 h-4 animate-spin" /> {statusMsg || "WORKING…"}</> : <><Plus className="w-4 h-4" /> ADD DATA</>}
          </button>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 text-[11px] font-mono text-[#ffb4ab] bg-[#ffb4ab]/5 border border-[#ffb4ab]/20 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {totalDatasets === 0 ? (
        <div className="glass-panel rounded-xl border border-white/5 p-5">
          <div className="flex flex-col items-center justify-center h-[300px] text-center gap-3">
            <FileSpreadsheet className="w-11 h-11 text-[#8aebff]/30" />
            <p className="text-sm text-[#bbc9cd]">This project is empty — add one or more datasets to begin.</p>
            <p className="text-[11px] font-mono text-[#859397] max-w-lg">
              Add <b className="text-[#bbc9cd]">CSV · TSV · JSON · XML · Excel · Parquet · SQLite</b> (drop several — every sheet/table becomes
              its own dataset). JARVIS profiles them, finds how they <b>relate</b>, and answers questions <b>across</b> them. Everything runs
              and is stored <b>in your browser</b>; nothing leaves your machine.
            </p>
            {pyState === "loading" && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#8aebff] bg-[#8aebff]/[0.06] border border-[#8aebff]/20 rounded-full px-3 py-1.5 mt-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {statusMsg || "Warming up the Python runtime — one-time ~20MB, then cached."}
              </div>
            )}
            {pyState === "ready" && !busyLoad && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#5eead4] bg-[#5eead4]/[0.06] border border-[#5eead4]/20 rounded-full px-3 py-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5eead4]" /> Runtime ready — add a dataset.
              </div>
            )}
            {pyState === "error" && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#ffb4ab] bg-[#ffb4ab]/[0.06] border border-[#ffb4ab]/20 rounded-full px-3 py-1.5 mt-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Couldn't load the Python runtime — check your connection and refresh.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column — datasets + relationships + recon */}
          <div className="lg:col-span-1 space-y-4">
            {/* Datasets */}
            <div className="glass-panel rounded-xl border border-white/5 p-4">
              <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] flex items-center gap-2 mb-3">
                <Table2 className="w-4 h-4" /> Datasets · {totalDatasets}
              </h3>
              <div className="space-y-2">
                {files.map((lf) => lf.names.map((n) => {
                  const dp = profByName(n);
                  return (
                    <div key={n} className="border border-white/5 rounded-lg bg-white/[0.02]">
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        <button onClick={() => setExpanded(expanded === n ? null : n)} className="flex-1 text-left cursor-pointer min-w-0">
                          <div className="text-[12px] font-mono text-[#8aebff] font-semibold truncate">{n}</div>
                          <div className="text-[9px] font-mono text-[#5c6a6d]">
                            {dp ? `${dp.nrows.toLocaleString()} rows · ${dp.ncols} cols` : "…"}{lf.names.length > 1 ? ` · ${lf.rec.fileName}` : ""}
                          </div>
                        </button>
                        <button onClick={() => runClean(n)} disabled={cleaning === n} title="Clean this dataset"
                          className="p-1 text-[#5c6a6d] hover:text-[#5eead4] cursor-pointer disabled:opacity-50">
                          {cleaning === n ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => removeFile(lf)} title="Remove (whole file)"
                          className="p-1 text-[#5c6a6d] hover:text-[#ffb4ab] cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                      </div>
                      {expanded === n && dp && (
                        <div className="px-2 pb-2 space-y-1.5 max-h-72 overflow-y-auto">
                          {dp.columns.map((c) => <ColRow key={c.name} c={c} />)}
                        </div>
                      )}
                    </div>
                  );
                }))}
              </div>
              <button onClick={() => fileRef.current?.click()} disabled={busyLoad}
                className="w-full mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold font-mono border border-white/10 bg-white/5 text-[#bbc9cd] hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> ADD DATASET
              </button>
            </div>

            {/* Relationships */}
            {prof && prof.relationships.length > 0 && (
              <div className="glass-panel rounded-xl border border-white/5 p-4">
                <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] flex items-center gap-2 mb-3">
                  <Link2 className="w-4 h-4" /> Detected links
                </h3>
                <div className="space-y-1.5">
                  {prof.relationships.map((r, i) => (
                    <div key={i} className="text-[10px] font-mono text-[#bbc9cd] flex items-center gap-1.5">
                      <span className="text-[#c084fc]">{r.left}</span>.<span className="text-[#8aebff]">{r.leftCol}</span>
                      <Link2 className="w-3 h-3 text-[#5c6a6d]" />
                      <span className="text-[#c084fc]">{r.right}</span>.<span className="text-[#8aebff]">{r.rightCol}</span>
                      <span className="text-[#5c6a6d] ml-auto">{Math.round(r.overlap * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recon */}
            <div className="glass-panel rounded-xl border border-white/5 p-4">
              <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4" /> Analyst's read
              </h3>
              {reconLoading ? (
                <div className="flex items-center gap-2 text-[11px] font-mono text-[#859397]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Forming hypotheses…</div>
              ) : recon ? (
                <div className="space-y-3">
                  {recon.read && <p className="text-[12px] text-[#dfe2f3] leading-relaxed italic">{recon.read}</p>}
                  {recon.hypotheses.length > 0 && (
                    <div>
                      <div className="text-[9px] font-mono uppercase tracking-widest text-[#5c6a6d] mb-1.5">Hypotheses</div>
                      <ul className="space-y-1.5">
                        {recon.hypotheses.map((h, i) => (
                          <li key={i} className="text-[11px] text-[#bbc9cd] leading-snug flex gap-1.5"><span className="text-[#8aebff]">›</span> {h}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {recon.kpis.length > 0 && (
                    <div>
                      <div className="text-[9px] font-mono uppercase tracking-widest text-[#5c6a6d] mb-1.5 flex items-center gap-1"><Target className="w-3 h-3" /> KPIs to watch</div>
                      <div className="space-y-1.5">
                        {recon.kpis.map((k, i) => (
                          <div key={i} className="text-[11px]"><span className="text-[#ffd6a3] font-semibold">{k.name}</span> <span className="text-[#859397]">— {k.why}</span></div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] font-mono text-[#5c6a6d]">No read available.</p>
              )}
            </div>
          </div>

          {/* Right column — ask + answers */}
          <div className="lg:col-span-2 space-y-4">
            <div className="glass-panel rounded-xl border border-white/5 p-3 flex items-center gap-2">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                placeholder={totalDatasets > 1 ? "Ask across your datasets — join, compare, correlate, cluster…" : "Ask anything — correlations, top drivers, distribution, trend…"} disabled={busy}
                className="flex-1 bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
              <button onClick={() => ask()} disabled={busy || !question.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-40">
                <Send className="w-4 h-4" />
              </button>
            </div>

            {recon && recon.questions.length > 0 && turns.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {recon.questions.map((qq, i) => (
                  <button key={i} onClick={() => ask(qq)} disabled={busy}
                    className="text-[11px] font-mono px-3 py-1.5 rounded-full border border-[#8aebff]/20 bg-[#8aebff]/[0.06] text-[#bbc9cd] hover:text-[#8aebff] hover:border-[#8aebff]/40 transition-all cursor-pointer disabled:opacity-40">
                    {qq}
                  </button>
                ))}
              </div>
            )}

            {turns.length === 0 && (!recon || recon.questions.length === 0) && (
              <p className="text-[11px] font-mono text-[#859397] text-center py-6">Ask a question about your data — JARVIS writes and runs the pandas for you.</p>
            )}

            {[...turns].reverse().map((t) => (
              <div key={t.id} className="glass-panel rounded-xl border border-white/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-[13px] text-[#dfe2f3]"><Sparkles className="w-3.5 h-3.5 text-[#8aebff] shrink-0" /> {t.q}</div>
                {t.running ? (
                  <div className="flex items-center gap-2 text-[11px] font-mono text-[#859397]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing + running the analysis…</div>
                ) : t.error ? (
                  <div className="flex items-start gap-2 text-[11px] font-mono text-[#ffb4ab]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{t.retried ? "Auto-correction attempt also failed: " : ""}{t.error}</span>
                  </div>
                ) : (
                  <>
                    {t.retried && (
                      <div className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-[#5eead4] bg-[#5eead4]/10 border border-[#5eead4]/20 rounded-full px-2 py-0.5">
                        <RefreshCw className="w-2.5 h-2.5" /> self-corrected
                      </div>
                    )}
                    {t.explanation && <p className="text-[12px] text-[#bbc9cd] leading-relaxed">{t.explanation}</p>}
                    {t.image && <img src={`data:image/png;base64,${t.image}`} alt="chart" className="w-full rounded-lg border border-white/10 bg-white" />}
                    {t.result && t.result.kind !== "none" && renderResult(t)}
                    {t.scrLoading && (
                      <div className="flex items-center gap-2 text-[10px] font-mono text-[#5c6a6d]"><Loader2 className="w-3 h-3 animate-spin" /> Drafting executive brief…</div>
                    )}
                    {t.scr && renderScr(t.scr)}
                    {t.code && (
                      <details className="group">
                        <summary className="text-[10px] font-mono text-[#859397] cursor-pointer flex items-center gap-1 hover:text-[#8aebff]"><Code2 className="w-3 h-3" /> show code</summary>
                        <pre className="mt-2 bg-[#0a0e1a]/80 border border-white/10 rounded-lg p-3 text-[11px] font-mono text-[#a3e635] overflow-x-auto whitespace-pre-wrap">{t.code}</pre>
                      </details>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

const KIND_COLOR: Record<string, string> = { numeric: CYAN, datetime: PURPLE, categorical: GREEN, text: MUTED };
const ColRow: React.FC<{ c: ColProfile }> = ({ c }) => {
  return (
    <div className="border border-white/5 rounded-lg p-2.5 bg-white/[0.02]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono text-[#dfe2f3] font-semibold truncate">{c.name}</span>
        <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: KIND_COLOR[c.kind], background: `${KIND_COLOR[c.kind]}18` }}>{c.dtype}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[9px] font-mono text-[#859397]">
        <span className={c.missing_pct > 0 ? "text-[#ffd6a3]" : ""}>{c.missing_pct}% missing</span>
        <span>{c.nunique.toLocaleString()} unique</span>
        {c.kind === "numeric" && c.mean !== undefined && (
          <>
            <span>μ {c.mean}</span><span>med {c.median}</span><span>σ {c.std}</span>
            {typeof c.skew === "number" && Math.abs(c.skew) > 1 && <span className="text-[#ffd6a3]">skew {c.skew}</span>}
            {typeof c.outliers === "number" && c.outliers > 0 && <span className="text-[#ffb4ab]">{c.outliers} outliers</span>}
          </>
        )}
        {c.kind === "datetime" && c.min !== undefined && <span>{String(c.min)} → {String(c.max)}</span>}
      </div>
      {c.top && c.top.length > 0 && (
        <div className="mt-1 text-[9px] font-mono text-[#5c6a6d] truncate">top: {c.top.slice(0, 3).map((d) => `${d.value} (${d.count})`).join(", ")}</div>
      )}
    </div>
  );
};

function renderScr(scr: Scr) {
  return (
    <div className="rounded-lg border border-[#8aebff]/15 bg-[#8aebff]/[0.04] p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#8aebff]"><ClipboardList className="w-3.5 h-3.5" /> Executive brief</div>
      {scr.scorecard && scr.scorecard.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scr.scorecard.map((s, i) => <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#8aebff]/10 text-[#8aebff] border border-[#8aebff]/20">{s}</span>)}
        </div>
      )}
      {scr.descriptive && <BriefRow label="What" text={scr.descriptive} color="#dfe2f3" />}
      {scr.diagnostic && <BriefRow label="Why" text={scr.diagnostic} color="#ffd6a3" />}
      {scr.prescriptive && <BriefRow label="Do" text={scr.prescriptive} color="#5eead4" />}
    </div>
  );
}
function BriefRow({ label, text, color }: { label: string; text: string; color: string }) {
  return (
    <div className="flex gap-2 text-[11px] leading-relaxed">
      <span className="font-mono font-bold uppercase text-[9px] tracking-widest w-8 shrink-0 pt-0.5" style={{ color }}>{label}</span>
      <span className="text-[#bbc9cd]">{text}</span>
    </div>
  );
}

function renderResult(t: Turn) {
  const r = t.result!;
  if (r.kind === "scalar") return <div className="text-2xl font-bold font-mono text-[#8aebff]">{String(r.value)}</div>;
  if (r.kind !== "table") return null;
  const { columns, rows } = r;
  const chart = t.chart && rows.length > 0 ? reconcileChart(t.chart, columns, rows) : null;
  return (
    <div className="space-y-3">
      {chart && renderChart(chart, rows)}
      <div className="overflow-auto rounded-lg border border-white/5 max-h-72">
        <table className="w-full text-[11px] font-mono">
          <thead className="sticky top-0"><tr className="bg-[#0f131f]">{columns.map((c) => (
            <th key={c} className="text-left px-3 py-2 text-[#8aebff] font-semibold whitespace-nowrap">{c}</th>
          ))}</tr></thead>
          <tbody>{rows.map((row, i) => (
            <tr key={i} className="border-t border-white/5 hover:bg-white/[0.03]">{columns.map((c) => (
              <td key={c} className="px-3 py-1.5 text-[#dfe2f3] whitespace-nowrap">{fmt(row[c])}</td>
            ))}</tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  return String(v ?? "");
}

// Make the chart valid against the ACTUAL result columns/values (the model predicts x/y before it
// knows what pandas will name them). Returns null when nothing numeric is plottable.
function reconcileChart(chart: Chart, columns: string[], rows: Record<string, unknown>[]): Chart | null {
  if (!columns.length) return null;
  const numericCols = columns.filter((c) => rows.some((row) => typeof row[c] === "number"));
  if (!numericCols.length) return null;
  let x = chart.x, y = chart.y;
  if (!numericCols.includes(y)) y = numericCols[0];
  if (!columns.includes(x) || x === y) {
    x = columns.find((c) => c !== y && !numericCols.includes(c)) ?? columns.find((c) => c !== y) ?? columns[0];
  }
  if (x === y) return null;
  return { type: chart.type, x, y };
}

function renderChart(chart: Chart, rows: Record<string, unknown>[]) {
  const data = rows.slice(0, 40);
  const axis = { fill: MUTED, fontSize: 10, fontFamily: "monospace" };
  if (chart.type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} dataKey={chart.y} nameKey={chart.x} outerRadius={90} label>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={tip} /><Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "line") {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
          <XAxis dataKey={chart.x} tick={axis} /><YAxis tick={axis} /><Tooltip contentStyle={tip} />
          <Line type="monotone" dataKey={chart.y} stroke={CYAN} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey={chart.x} tick={axis} /><YAxis tick={axis} /><Tooltip contentStyle={tip} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey={chart.y} fill={CYAN} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
