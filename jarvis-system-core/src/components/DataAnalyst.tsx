import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  Upload, Table2, Send, Loader2, AlertTriangle, Code2, Sparkles, FileSpreadsheet,
  ClipboardList, Wand2, Lightbulb, Target, Database, RefreshCw,
} from "lucide-react";

/* AI Data Analyst — a browser-native senior-analyst agent. Upload a dataset (CSV/TSV/JSON/XML/
 * Excel/Parquet/SQLite), and everything runs ENTIRELY IN YOUR BROWSER via Pyodide (the server
 * never executes code, so the free-tier instance is never at risk). It profiles the data (Phase 1),
 * offers a one-click semantic clean (Phase 2), writes+runs pandas/matplotlib for your questions
 * with a self-correcting retry (Phase 2/3/5), and closes each answer with a decision-ready
 * Situation→Complication→Resolution brief (Phase 6). */

interface PyAPI {
  runPythonAsync: (code: string) => Promise<unknown>;
  loadPackage: (pkgs: string[], messageCallback?: (msg: string) => void) => Promise<void>;
  globals: { set: (k: string, v: unknown) => void };
}

const PYODIDE_VER = "0.26.4";
let _py: Promise<PyAPI> | null = null;
const _loaded = new Set<string>(["pandas", "numpy"]);
function loadPy(onProgress?: (msg: string) => void): Promise<PyAPI> {
  if (_py) {
    if (onProgress) onProgress("Ready");
    return _py;
  }
  
  const CDNs = [
    `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/`,
    `https://fastly.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/`,
    `https://gcore.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/`
  ];
  
  let cdnIndex = 0;
  
  _py = new Promise((resolve, reject) => {
    const loadNext = () => {
      if (cdnIndex >= CDNs.length) {
        _py = null;
        reject(new Error("All CDNs failed to load Pyodide. Check your connection."));
        return;
      }
      const url = CDNs[cdnIndex];
      if (onProgress) onProgress(`Connecting to Python runtime CDN #${cdnIndex + 1}…`);
      const s = document.createElement("script");
      s.src = `${url}pyodide.js`;
      s.onload = async () => {
        try {
          if (onProgress) onProgress("Initializing Python runtime…");
          const load = (window as unknown as { loadPyodide: (o: { indexURL: string }) => Promise<PyAPI> }).loadPyodide;
          const py = await load({ indexURL: url });
          if (onProgress) onProgress("Loading pandas & numpy (~20MB)…");
          await py.loadPackage(["pandas", "numpy"], (msg) => {
            if (onProgress) onProgress(msg);
          });
          resolve(py);
        } catch (e) {
          console.warn(`CDN ${url} failed to initialize, trying next...`, e);
          cdnIndex++;
          loadNext();
        }
      };
      s.onerror = () => {
        console.warn(`CDN ${url} failed to load script, trying next...`);
        cdnIndex++;
        loadNext();
      };
      document.head.appendChild(s);
    };
    
    loadNext();
  });
  return _py;
}
async function ensurePkgs(py: PyAPI, pkgs: string[]) {
  const need = pkgs.filter((p) => !_loaded.has(p));
  if (need.length) { await py.loadPackage(need); need.forEach((p) => _loaded.add(p)); }
}
// Resolve the pandas Excel engine. In Pyodide 0.26.4 openpyxl is NOT in the loadPackage
// distribution, but it's pure-Python — install it from PyPI via micropip. Old .xls uses xlrd,
// which IS a loadPackage package. Returns the engine name to hand to pandas.
async function ensureExcel(py: PyAPI, ext: string): Promise<string> {
  if (ext === "xls") { await ensurePkgs(py, ["xlrd"]); return "xlrd"; }
  if (!_loaded.has("openpyxl")) {
    await ensurePkgs(py, ["micropip"]);
    await py.runPythonAsync("import micropip\nawait micropip.install('openpyxl')");
    _loaded.add("openpyxl");
  }
  return "openpyxl";
}

// ── format dispatch ──────────────────────────────────────────────────────────
interface Fmt { fmt: string; binary: boolean; pkgs: string[]; }
function detectFmt(name: string): Fmt | null {
  const ext = (name.toLowerCase().split(".").pop() || "");
  switch (ext) {
    case "csv": return { fmt: "csv", binary: false, pkgs: [] };
    case "tsv": case "tab": return { fmt: "tsv", binary: false, pkgs: [] };
    case "json": return { fmt: "json", binary: false, pkgs: [] };
    case "xml": return { fmt: "xml", binary: false, pkgs: ["lxml"] };
    case "parquet": return { fmt: "parquet", binary: true, pkgs: ["fastparquet"] }; // pyarrow absent in Pyodide
    case "xlsx": case "xls": return { fmt: ext, binary: true, pkgs: [] }; // engine loaded in ingest()
    case "db": case "sqlite": case "sqlite3": return { fmt: "sqlite", binary: true, pkgs: [] };
    default: return null;
  }
}
const MAX_BYTES = 15 * 1024 * 1024;

const CYAN = "#8aebff", GREEN = "#5eead4", AMBER = "#ffd6a3", PURPLE = "#c084fc", MUTED = "#859397";
const PIE_COLORS = [CYAN, GREEN, AMBER, PURPLE, "#a3e635", "#ffb4ab", "#22d3ee", "#f0abfc"];
const tip = { background: "#0f131f", border: "1px solid #3c494c", borderRadius: 8, fontFamily: "monospace", fontSize: 12, color: "#dfe2f3" };
const JSON_HEADERS = { "Content-Type": "application/json" };

// ── Python snippets (run client-side; NOT the LLM-generated code) ─────────────
const INGEST_PY = `
import json as _json, io as _io
import pandas as pd, numpy as np
_fmt = fmt
_pick = pick_name or None
_sources = []
def _b(): return bytes(src_bytes.to_py())
if _fmt in ('csv','tsv'):
    df = pd.read_csv(_io.StringIO(src_text), sep='\\t' if _fmt=='tsv' else ',')
elif _fmt=='json':
    try:
        df = pd.read_json(_io.StringIO(src_text))
    except Exception:
        import json as __j
        df = pd.json_normalize(__j.loads(src_text))
elif _fmt=='xml':
    df = pd.read_xml(_io.StringIO(src_text))
elif _fmt=='parquet':
    df = pd.read_parquet(_io.BytesIO(_b()), engine='fastparquet')
elif _fmt in ('xlsx','xls'):
    _xl = pd.ExcelFile(_io.BytesIO(_b()), engine=excel_engine)
    _sources = [str(s) for s in _xl.sheet_names]
    _p = _pick if _pick in _sources else _sources[0]
    df = _xl.parse(_p); _pick = _p
elif _fmt=='sqlite':
    import sqlite3
    with open('/tmp/_up.db','wb') as _f: _f.write(_b())
    _con = sqlite3.connect('/tmp/_up.db')
    _sources = [r[0] for r in _con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
    if not _sources: raise ValueError('No tables in this SQLite database.')
    _p = _pick if _pick in _sources else _sources[0]
    df = pd.read_sql('SELECT * FROM "%s"' % _p, _con); _pick = _p
else:
    raise ValueError('Unsupported format: ' + str(_fmt))
df.columns = [str(c) for c in df.columns]
for _c in df.columns:
    if df[_c].dtype == object:
        _s = df[_c].dropna().astype(str).head(20)
        if len(_s) and _s.str.match(r'^\\d{4}-\\d{2}-\\d{2}').mean() > 0.7:
            try: df[_c] = pd.to_datetime(df[_c], errors='coerce')
            except Exception: pass
_json.dumps({"sources": _sources, "picked": _pick})
`;

const PROFILE_PY = `
import json as _json
import pandas as pd, numpy as np
def _prof():
    n = int(len(df)); cols = []
    lines = [str(n) + " rows x " + str(len(df.columns)) + " columns.", "Columns:"]
    for c in df.columns:
        s = df[c]; miss = float(s.isna().mean()*100.0); nun = int(s.nunique(dropna=True))
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
            else:
                lines.append("- %s (%s) - all missing" % (c, s.dtype))
        elif pd.api.types.is_datetime64_any_dtype(s):
            col["kind"]="datetime"; sv=s.dropna()
            if len(sv):
                col["min"]=str(sv.min())[:19]; col["max"]=str(sv.max())[:19]
                lines.append("- %s (datetime) - %s%% missing; range %s to %s" % (c, round(miss,1), col['min'], col['max']))
            else:
                lines.append("- %s (datetime) - all missing" % c)
        else:
            col["kind"]="categorical" if nun<=max(30, n*0.5) else "text"
            vc = s.dropna().astype(str).value_counts().head(5)
            col["top"]=[{"value":str(k)[:40],"count":int(v)} for k,v in vc.items()]
            _t = ", ".join(d["value"]+"("+str(d["count"])+")" for d in col["top"][:3])
            lines.append("- %s (%s) - %s%% missing, %d unique; top: %s" % (c, s.dtype, round(miss,1), nun, _t))
        cols.append(col)
    return {"nrows":n,"ncols":int(len(df.columns)),"columns":cols,"profileText":"\\n".join(lines)}
_json.dumps(_prof())
`;

const CLEAN_PY = `
import json as _json
import pandas as pd, numpy as np
_report = []
for _c in list(df.columns):
    _s = df[_c]
    if _s.dtype == object:
        _cl = _s.astype(str).str.strip().str.replace(r'\\s+', ' ', regex=True)
        _cl = _cl.replace({'nan': np.nan, 'None': np.nan, 'NaN': np.nan, '': np.nan})
        _nf = int(_cl.isna().sum())
        df[_c] = _cl.fillna('Unknown')
        if _nf: _report.append(_c + ": filled " + str(_nf) + " missing with 'Unknown'")
    elif pd.api.types.is_numeric_dtype(_s):
        _m = int(_s.isna().sum())
        if _m:
            df[_c] = _s.fillna(_s.median())
            _report.append(_c + ": imputed " + str(_m) + " missing with median")
_before = len(df); df.drop_duplicates(inplace=True); _drop = _before - len(df)
if _drop: _report.append("removed " + str(_drop) + " duplicate rows")
if not _report: _report.append("Already clean — no missing values, whitespace issues or duplicates found.")
_json.dumps(_report)
`;

const RUNNER_HEAD = `
import json as _json, io as _io, base64 as _b64
import pandas as pd, numpy as np
import matplotlib
matplotlib.use('AGG')
import matplotlib.pyplot as plt
plt.close('all')
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
interface Profile { nrows: number; ncols: number; columns: ColProfile[]; profileText: string; }
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

export default function DataAnalyst() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fileName, setFileName] = useState("");
  const [srcFmt, setSrcFmt] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [picked, setPicked] = useState("");
  const [loadingCsv, setLoadingCsv] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [csvError, setCsvError] = useState("");
  const [recon, setRecon] = useState<Recon | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanReport, setCleanReport] = useState<string[] | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [pyState, setPyState] = useState<"loading" | "ready" | "error">("loading");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastFile = useRef<File | null>(null);

  // Prefetch the ~20MB Pyodide + pandas/numpy runtime the moment this screen mounts, so the
  // download overlaps with the user picking a file instead of starting only on upload. It's a
  // one-time cost — the browser caches it for every later visit.
  useEffect(() => {
    let alive = true;
    loadPy((msg) => { if (alive) setStatusMsg(msg); })
      .then(() => { if (alive) setPyState("ready"); })
      .catch(() => { if (alive) setPyState("error"); });
    return () => { alive = false; };
  }, []);

  const loadRecon = useCallback(async (profileText: string) => {
    setRecon(null); setReconLoading(true);
    try {
      const r = await fetch("/api/analyst/hypotheses", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ profile: profileText }) });
      const d = await r.json();
      if (r.ok && !d.error) setRecon(d);
    } catch { /* recon is best-effort */ } finally { setReconLoading(false); }
  }, []);

  const ingest = useCallback(async (file: File, pick?: string) => {
    const det = detectFmt(file.name);
    if (!det) { setCsvError("Unsupported format. Use CSV, TSV, JSON, XML, Parquet, Excel (.xlsx) or SQLite (.db)."); return; }
    if (file.size > MAX_BYTES) { setCsvError("File is too large (max 15MB) — sample it down first."); return; }
    setLoadingCsv(true); setCsvError(""); setCleanReport(null);
    if (!pick) { setTurns([]); setProfile(null); setRecon(null); }
    try {
      setStatusMsg("Loading Python runtime…");
      const py = await loadPy();
      let excelEngine = "openpyxl";
      if (det.fmt === "xlsx" || det.fmt === "xls") {
        setStatusMsg("Loading Excel reader…");
        excelEngine = await ensureExcel(py, det.fmt);
      } else if (det.pkgs.length) {
        setStatusMsg(`Loading ${det.pkgs.join(", ")}…`);
        await ensurePkgs(py, det.pkgs);
      }
      setStatusMsg("Reading + profiling…");
      py.globals.set("fmt", det.fmt);
      py.globals.set("excel_engine", excelEngine);
      py.globals.set("pick_name", pick ?? "");
      if (det.binary) py.globals.set("src_bytes", new Uint8Array(await file.arrayBuffer()));
      else py.globals.set("src_text", await file.text());
      const ing = JSON.parse((await py.runPythonAsync(INGEST_PY)) as string) as { sources: string[]; picked: string | null };
      setSources(ing.sources || []);
      setPicked(ing.picked || "");
      const prof = JSON.parse((await py.runPythonAsync(PROFILE_PY)) as string) as Profile;
      setProfile(prof); setFileName(file.name); setSrcFmt(det.fmt);
      lastFile.current = file;
      loadRecon(prof.profileText);
    } catch (e) {
      setCsvError(`Couldn't read that file: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoadingCsv(false); setStatusMsg("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [loadRecon]);

  const reprofile = useCallback(async () => {
    const py = await loadPy();
    const prof = JSON.parse((await py.runPythonAsync(PROFILE_PY)) as string) as Profile;
    setProfile(prof);
    return prof;
  }, []);

  const runClean = useCallback(async () => {
    if (!profile || cleaning) return;
    setCleaning(true);
    try {
      const py = await loadPy();
      const rep = JSON.parse((await py.runPythonAsync(CLEAN_PY)) as string) as string[];
      setCleanReport(rep);
      await reprofile();
    } catch (e) {
      setCsvError(`Clean failed: ${e instanceof Error ? e.message : e}`);
    } finally { setCleaning(false); }
  }, [profile, cleaning, reprofile]);

  const ask = useCallback(async (preset?: string) => {
    const q = (preset ?? question).trim();
    if (!q || !profile || busy) return;
    if (!preset) setQuestion("");
    setBusy(true);
    const id = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? String(Date.now() + Math.random());
    setTurns((t) => [...t, { id, q, running: true }]);
    const patch = (p: Partial<Turn>) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const schema = profile.profileText;
    try {
      const py = await loadPy();
      const gen = await fetchCode(q, schema);
      if (gen.error) { patch({ running: false, error: gen.error }); return; }
      await ensurePkgs(py, gen.code.includes("scipy") ? ["matplotlib", "scipy"] : ["matplotlib"]);
      let run = await runGenerated(py, gen.code);
      let usedCode = gen.code, usedExpl = gen.explanation, usedChart = gen.chart, retried = false;

      if (!run.ok) {
        // Phase 2.3 — self-correcting loop: feed the stack trace back, retry once.
        const gen2 = await fetchCode(q, schema, gen.code, run.error);
        if (!gen2.error) {
          await ensurePkgs(py, gen2.code.includes("scipy") ? ["matplotlib", "scipy"] : ["matplotlib"]);
          const run2 = await runGenerated(py, gen2.code);
          if (run2.ok) { run = run2; usedCode = gen2.code; usedExpl = gen2.explanation; usedChart = gen2.chart; retried = true; }
          else { patch({ running: false, code: gen2.code, explanation: gen2.explanation, error: run2.error, retried: true }); return; }
        } else { patch({ running: false, code: gen.code, explanation: gen.explanation, error: run.error }); return; }
      }

      patch({ running: false, code: usedCode, explanation: usedExpl, chart: usedChart, result: run.result, image: run.image, retried, scrLoading: true });

      // Phase 6 — executive SCR synthesis on the actual result (best-effort, non-blocking).
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
  }, [question, profile, busy]);

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.4 }} className="space-y-6">
      {/* Header */}
      <section className="pt-4 flex flex-col md:flex-row justify-between md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
            <span className="opacity-40 font-light text-xl">04 //</span> DATA ANALYST
          </h1>
          <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
            Any dataset · profiled, cleaned, questioned & briefed — in your browser
          </p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.tab,.json,.xml,.parquet,.xlsx,.xls,.db,.sqlite,.sqlite3" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) ingest(f); }} />
        <button onClick={() => fileRef.current?.click()} disabled={loadingCsv}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold font-mono border border-[#8aebff]/30 bg-[#8aebff]/10 text-[#8aebff] hover:bg-[#8aebff]/20 transition-all cursor-pointer disabled:opacity-50">
          {loadingCsv ? <><Loader2 className="w-4 h-4 animate-spin" /> {statusMsg || "LOADING…"}</> : <><Upload className="w-4 h-4" /> {profile ? "REPLACE DATA" : "UPLOAD DATA"}</>}
        </button>
      </section>

      {csvError && (
        <div className="flex items-start gap-2 text-[11px] font-mono text-[#ffb4ab] bg-[#ffb4ab]/5 border border-[#ffb4ab]/20 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{csvError}</span>
        </div>
      )}

      {!profile ? (
        <div className="glass-panel rounded-xl border border-white/5 p-5">
          <div className="flex flex-col items-center justify-center h-[300px] text-center gap-3">
            <FileSpreadsheet className="w-11 h-11 text-[#8aebff]/30" />
            <p className="text-sm text-[#bbc9cd]">Drop in a dataset — JARVIS profiles it and takes questions.</p>
            <p className="text-[11px] font-mono text-[#859397] max-w-lg">
              Supports <b className="text-[#bbc9cd]">CSV · TSV · JSON · XML · Excel (.xlsx) · Parquet · SQLite (.db)</b>. Everything —
              profiling, cleaning, the pandas & matplotlib you ask for — runs <b>in your browser</b> (Pyodide; nothing leaves your
              machine, the server never executes code).
            </p>
            {pyState === "loading" && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#8aebff] bg-[#8aebff]/[0.06] border border-[#8aebff]/20 rounded-full px-3 py-1.5 mt-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {statusMsg || "Warming up the Python runtime — one-time ~20MB download, then cached. Pick a file meanwhile."}
              </div>
            )}
            {pyState === "ready" && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#5eead4] bg-[#5eead4]/[0.06] border border-[#5eead4]/20 rounded-full px-3 py-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5eead4]" /> Runtime ready — upload a dataset.
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
          {/* Left column — dataset + recon */}
          <div className="lg:col-span-1 space-y-4">
            {/* Dataset summary */}
            <div className="glass-panel rounded-xl border border-white/5 p-4">
              <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] flex items-center gap-2 mb-3">
                <Database className="w-4 h-4" /> <span className="truncate">{fileName}</span>
              </h3>
              <p className="text-[10px] font-mono text-[#859397] mb-3">
                {profile.nrows.toLocaleString()} rows · {profile.ncols} columns · <span className="uppercase">{srcFmt}</span>
              </p>
              {sources.length > 1 && (
                <div className="mb-3">
                  <label className="text-[9px] font-mono uppercase tracking-widest text-[#5c6a6d] block mb-1">
                    {srcFmt === "sqlite" ? "Table" : "Sheet"}
                  </label>
                  <select value={picked} onChange={(e) => { const f = lastFile.current; if (f) ingest(f, e.target.value); }}
                    className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-2 py-1.5 font-mono text-[11px] text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40">
                    {sources.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={runClean} disabled={cleaning}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold font-mono border border-[#5eead4]/25 bg-[#5eead4]/10 text-[#5eead4] hover:bg-[#5eead4]/20 transition-all cursor-pointer disabled:opacity-50">
                  {cleaning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} CLEAN DATA
                </button>
                <button onClick={() => setShowProfile((v) => !v)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold font-mono border border-white/10 bg-white/5 text-[#bbc9cd] hover:bg-white/10 transition-all cursor-pointer">
                  <Table2 className="w-3.5 h-3.5" /> {showProfile ? "HIDE" : "PROFILE"}
                </button>
              </div>
              {cleanReport && (
                <div className="mt-3 text-[10px] font-mono text-[#5eead4] bg-[#5eead4]/5 border border-[#5eead4]/15 rounded-lg p-2.5 space-y-1">
                  <div className="text-[#859397] uppercase tracking-widest text-[9px] mb-1">Cleaned</div>
                  {cleanReport.map((r, i) => <div key={i}>• {r}</div>)}
                </div>
              )}
            </div>

            {/* Structural profile (collapsible) */}
            {showProfile && (
              <div className="glass-panel rounded-xl border border-white/5 p-4">
                <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-3">Structural reconnaissance</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {profile.columns.map((col: ColProfile) => <ColRow key={col.name} c={col} />)}
                </div>
              </div>
            )}

            {/* Recon — hypotheses + KPIs */}
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
                placeholder="Ask anything — correlations, top drivers, distribution, trend over time…" disabled={busy}
                className="flex-1 bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
              <button onClick={() => ask()} disabled={busy || !question.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-40">
                <Send className="w-4 h-4" />
              </button>
            </div>

            {/* Suggested starter questions */}
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
                    {t.image && (
                      <img src={`data:image/png;base64,${t.image}`} alt="chart" className="w-full rounded-lg border border-white/10 bg-white" />
                    )}
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
}

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
  if (r.kind === "scalar") {
    return <div className="text-2xl font-bold font-mono text-[#8aebff]">{String(r.value)}</div>;
  }
  if (r.kind !== "table") return null;
  const { columns, rows } = r;
  return (
    <div className="space-y-3">
      {t.chart && rows.length > 0 && renderChart(t.chart, rows)}
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
