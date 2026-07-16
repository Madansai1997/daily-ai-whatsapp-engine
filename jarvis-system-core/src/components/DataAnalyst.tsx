import React, { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Upload, Table2, Send, Loader2, AlertTriangle, Code2, Sparkles, FileSpreadsheet } from "lucide-react";

/* AI Data Analyst — upload a CSV, ask in plain English. JARVIS writes the pandas, and it runs
 * ENTIRELY IN YOUR BROWSER via Pyodide (the server never executes the code, so the free-tier
 * instance is never at risk). Results render as a table + an optional Recharts chart. */

interface PyAPI {
  runPythonAsync: (code: string) => Promise<unknown>;
  loadPackage: (pkgs: string[]) => Promise<void>;
  globals: { set: (k: string, v: unknown) => void };
}

const PYODIDE_VER = "0.26.4";
let _py: Promise<PyAPI> | null = null;
function loadPy(): Promise<PyAPI> {
  if (_py) return _py;
  _py = new Promise((resolve, reject) => {
    const url = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/`;
    const s = document.createElement("script");
    s.src = `${url}pyodide.js`;
    s.onload = async () => {
      try {
        // window.loadPyodide is declared (with a different return type) in DailyUpdate; cast here.
        const load = (window as unknown as { loadPyodide: (o: { indexURL: string }) => Promise<PyAPI> }).loadPyodide;
        const py = await load({ indexURL: url });
        await py.loadPackage(["pandas", "numpy"]);
        resolve(py);
      } catch (e) { _py = null; reject(e); }
    };
    s.onerror = () => { _py = null; reject(new Error("Couldn't load the Python runtime (offline?).")); };
    document.head.appendChild(s);
  });
  return _py;
}

const CYAN = "#8aebff", GREEN = "#5eead4", AMBER = "#ffd6a3", PURPLE = "#c084fc", MUTED = "#859397";
const PIE_COLORS = [CYAN, GREEN, AMBER, PURPLE, "#a3e635", "#ffb4ab", "#22d3ee", "#f0abfc"];
const tip = { background: "#0f131f", border: "1px solid #3c494c", borderRadius: 8, fontFamily: "monospace", fontSize: 12, color: "#dfe2f3" };

interface Preview { columns: string[]; rows: Record<string, unknown>[]; schema: string; nrows: number; }
interface Chart { type: "bar" | "line" | "pie"; x: string; y: string; }
interface Turn {
  q: string;
  code?: string;
  explanation?: string;
  chart?: Chart | null;
  result?: { kind: "table"; columns: string[]; rows: Record<string, unknown>[] } | { kind: "scalar"; value: unknown };
  error?: string;
  running?: boolean;
}

export default function DataAnalyst() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState("");
  const [loadingCsv, setLoadingCsv] = useState(false);
  const [csvError, setCsvError] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onCsv = async (file: File) => {
    if (!/\.csv$/i.test(file.name)) { setCsvError("Please upload a .csv file."); return; }
    if (file.size > 8 * 1024 * 1024) { setCsvError("CSV is too large (max 8MB) — sample it down first."); return; }
    setLoadingCsv(true); setCsvError(""); setTurns([]); setPreview(null);
    try {
      const text = await file.text();
      const py = await loadPy();
      py.globals.set("csv_text", text);
      const previewJson = await py.runPythonAsync(`
import json as _json, io as _io
import pandas as pd, numpy as np
df = pd.read_csv(_io.StringIO(csv_text))
_schema = f"{len(df)} rows; columns: " + ", ".join(f"{c} ({df[c].dtype})" for c in df.columns)
_json.dumps({"columns":[str(c) for c in df.columns],
             "rows":_json.loads(df.head(8).to_json(orient="records")),
             "schema":_schema, "nrows":int(len(df))})
`);
      setPreview(JSON.parse(previewJson as string));
      setFileName(file.name);
    } catch (e) {
      setCsvError(`Couldn't read that CSV: ${e instanceof Error ? e.message : e}`);
    } finally {
      setLoadingCsv(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q || !preview || busy) return;
    setQuestion("");
    setBusy(true);
    setTurns((t) => [...t, { q, running: true }]);
    const finish = (patch: Partial<Turn>) =>
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, running: false, ...patch } : x)));
    try {
      const res = await fetch("/api/analyst/code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, schema: preview.schema }),
      });
      const d = await res.json();
      if (!res.ok || d.error) { finish({ error: d.error || `Request failed (${res.status}).` }); return; }
      const code: string = d.code;
      // Run the generated code in the SAME Pyodide instance (df already loaded), then serialize `result`.
      const py = await loadPy();
      const runner = `
import json as _json
${code}
def _ser(r):
    try:
        if isinstance(r, pd.DataFrame):
            _d = r.head(50)
            return {"kind":"table","columns":[str(c) for c in _d.columns],"rows":_json.loads(_d.to_json(orient="records"))}
        if isinstance(r, pd.Series):
            _d = r.head(50).reset_index()
            _d.columns = [str(c) for c in _d.columns]
            return {"kind":"table","columns":list(_d.columns),"rows":_json.loads(_d.to_json(orient="records"))}
        try:
            if isinstance(r, (np.integer,)): r = int(r)
            elif isinstance(r, (np.floating,)): r = float(r)
        except Exception:
            pass
        return {"kind":"scalar","value": r if isinstance(r,(int,float,str,bool)) else str(r)}
    except Exception as _e:
        return {"kind":"error","error":str(_e)}
_json.dumps(_ser(result))
`;
      const outStr = await py.runPythonAsync(runner);
      const result = JSON.parse(outStr as string);
      if (result.kind === "error") { finish({ code, explanation: d.explanation, error: result.error }); return; }
      finish({ code, explanation: d.explanation, chart: d.chart, result });
    } catch (e) {
      finish({ error: `Couldn't run the analysis: ${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy(false);
    }
  }, [question, preview, busy]);

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.4 }} className="space-y-6">
      {/* Header */}
      <section className="pt-4 flex flex-col md:flex-row justify-between md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
            <span className="opacity-40 font-light text-xl">04 //</span> DATA ANALYST
          </h1>
          <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
            Upload a CSV · ask in English · pandas runs in your browser
          </p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f); }} />
        <button onClick={() => fileRef.current?.click()} disabled={loadingCsv}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold font-mono border border-[#8aebff]/30 bg-[#8aebff]/10 text-[#8aebff] hover:bg-[#8aebff]/20 transition-all cursor-pointer disabled:opacity-50">
          {loadingCsv ? <><Loader2 className="w-4 h-4 animate-spin" /> LOADING RUNTIME…</> : <><Upload className="w-4 h-4" /> {preview ? "REPLACE CSV" : "UPLOAD CSV"}</>}
        </button>
      </section>

      {csvError && (
        <div className="flex items-start gap-2 text-[11px] font-mono text-[#ffb4ab] bg-[#ffb4ab]/5 border border-[#ffb4ab]/20 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{csvError}</span>
        </div>
      )}

      {!preview ? (
        <div className="glass-panel rounded-xl border border-white/5 p-5">
          <div className="flex flex-col items-center justify-center h-[300px] text-center gap-3">
            <FileSpreadsheet className="w-11 h-11 text-[#8aebff]/30" />
            <p className="text-sm text-[#bbc9cd]">Drop in a CSV and ask it anything.</p>
            <p className="text-[11px] font-mono text-[#859397] max-w-md">
              JARVIS writes the pandas, runs it <b>in your browser</b> (Pyodide — nothing leaves your machine, the server never executes code), and charts the result. First upload downloads the Python runtime (~a few MB).
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: dataset preview */}
          <div className="lg:col-span-1">
            <div className="glass-panel rounded-xl border border-white/5 p-4">
              <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] flex items-center gap-2 mb-3">
                <Table2 className="w-4 h-4" /> {fileName}
              </h3>
              <p className="text-[10px] font-mono text-[#859397] mb-3">{preview.nrows.toLocaleString()} rows · {preview.columns.length} columns</p>
              <div className="overflow-x-auto rounded-lg border border-white/5">
                <table className="w-full text-[10px] font-mono">
                  <thead><tr className="bg-white/[0.04]">{preview.columns.slice(0, 6).map((c) => (
                    <th key={c} className="text-left px-2 py-1.5 text-[#8aebff] font-semibold truncate max-w-[90px]">{c}</th>
                  ))}</tr></thead>
                  <tbody>{preview.rows.slice(0, 6).map((r, i) => (
                    <tr key={i} className="border-t border-white/5">{preview.columns.slice(0, 6).map((c) => (
                      <td key={c} className="px-2 py-1 text-[#bbc9cd] truncate max-w-[90px]">{String(r[c] ?? "")}</td>
                    ))}</tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="text-[9px] font-mono text-[#5c6a6d] mt-2">Showing first rows / columns.</p>
            </div>
          </div>

          {/* Right: ask + answers */}
          <div className="lg:col-span-2 space-y-4">
            <div className="glass-panel rounded-xl border border-white/5 p-3 flex items-center gap-2">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                placeholder="e.g. average by category, top 5 rows, monthly trend…" disabled={busy}
                className="flex-1 bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
              <button onClick={ask} disabled={busy || !question.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-40">
                <Send className="w-4 h-4" />
              </button>
            </div>

            {turns.length === 0 && (
              <p className="text-[11px] font-mono text-[#859397] text-center py-6">Ask a question about your data — JARVIS writes and runs the pandas for you.</p>
            )}

            {[...turns].reverse().map((t, ri) => {
              const i = turns.length - 1 - ri;
              return (
                <div key={i} className="glass-panel rounded-xl border border-white/5 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[13px] text-[#dfe2f3]"><Sparkles className="w-3.5 h-3.5 text-[#8aebff] shrink-0" /> {t.q}</div>
                  {t.running ? (
                    <div className="flex items-center gap-2 text-[11px] font-mono text-[#859397]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing + running the analysis…</div>
                  ) : t.error ? (
                    <div className="flex items-start gap-2 text-[11px] font-mono text-[#ffb4ab]"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t.error}</div>
                  ) : (
                    <>
                      {t.explanation && <p className="text-[12px] text-[#bbc9cd] leading-relaxed">{t.explanation}</p>}
                      {t.result && renderResult(t)}
                      {t.code && (
                        <details className="group">
                          <summary className="text-[10px] font-mono text-[#859397] cursor-pointer flex items-center gap-1 hover:text-[#8aebff]"><Code2 className="w-3 h-3" /> show pandas</summary>
                          <pre className="mt-2 bg-[#0a0e1a]/80 border border-white/10 rounded-lg p-3 text-[11px] font-mono text-[#a3e635] overflow-x-auto whitespace-pre-wrap">{t.code}</pre>
                        </details>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function renderResult(t: Turn) {
  const r = t.result!;
  if (r.kind === "scalar") {
    return <div className="text-2xl font-bold font-mono text-[#8aebff]">{String(r.value)}</div>;
  }
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
