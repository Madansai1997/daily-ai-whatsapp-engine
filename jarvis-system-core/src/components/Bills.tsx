import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, Plus, X, Wallet, CheckCircle2, Trash2, CalendarClock, AlertTriangle } from "lucide-react";

interface Bill {
  id: number;
  name: string;
  amount: number;
  currency: string;
  recurrence: "monthly" | "once" | "yearly";
  due_day?: number | null;
  due_date?: string | null;
  category?: string | null;
  notify_days_before: number;
  next_due?: string | null;
  days_until?: number | null;
}
interface BillsView {
  bills: Bill[];
  total: number;
  currency: string;
  due_soon: number;
}

const CYAN = "#8aebff", AMBER = "#ffd6a3", GREEN = "#5eead4", RED = "#ffb4ab";

const fmtAmt = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dueLabel = (b: Bill) => {
  if (b.days_until == null || !b.next_due) return "—";
  const d = new Date(b.next_due + "T00:00:00Z").toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  if (b.days_until === 0) return `Due today · ${d}`;
  if (b.days_until === 1) return `Due tomorrow · ${d}`;
  return `Due ${d} · in ${b.days_until}d`;
};

const dueColor = (b: Bill) => {
  const w = b.notify_days_before || 3;
  if (b.days_until == null) return "#859397";
  if (b.days_until <= 1) return RED;
  if (b.days_until <= w) return AMBER;
  return GREEN;
};

export default function Bills() {
  const [view, setView] = useState<BillsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const empty = { name: "", amount: "", recurrence: "monthly", due_day: "", due_date: "", notify_days_before: "3" };
  const [form, setForm] = useState({ ...empty });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bills", { cache: "no-store" });
      if (res.ok) setView(await res.json());
    } catch { /* keep */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addBill = async () => {
    if (!form.name.trim()) { setErr("Give the bill a name."); return; }
    if (form.recurrence === "monthly" && !form.due_day) { setErr("Which day of the month is it due?"); return; }
    if (form.recurrence !== "monthly" && !form.due_date) { setErr("Pick the due date."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/bills", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, amount: parseFloat(form.amount) || 0, recurrence: form.recurrence,
          due_day: form.due_day ? parseInt(form.due_day) : null,
          due_date: form.due_date || null,
          notify_days_before: parseInt(form.notify_days_before) || 3,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.result || `HTTP ${res.status}`);
      setAddOpen(false); setForm({ ...empty }); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  const markPaid = async (id: number) => {
    setBusy(id);
    try { await fetch(`/api/bills/${id}/paid`, { method: "POST" }); await load(); }
    finally { setBusy(null); }
  };
  const remove = async (id: number, name: string) => {
    if (!confirm(`Stop tracking "${name}"?`)) return;
    setBusy(id);
    try { await fetch(`/api/bills/${id}/delete`, { method: "POST" }); await load(); }
    finally { setBusy(null); }
  };

  const bills = view?.bills || [];
  const cur = view?.currency || "₹";

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.4 }} className="space-y-6">
      {/* Header */}
      <section className="pt-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
            <span className="opacity-40 font-light text-xl">06 //</span> BILLS &amp; DEADLINES
          </h1>
          <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
            Recurring bills · one-off deadlines · due-date alerts
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <button onClick={() => { setForm({ ...empty }); setErr(""); setAddOpen(true); }} className="flex items-center gap-2 px-5 py-2 bg-[#8aebff]/10 border border-[#8aebff]/30 rounded-lg text-xs font-semibold hover:bg-[#8aebff]/20 transition-all text-[#8aebff] cursor-pointer">
            <Plus className="w-4 h-4" /> ADD BILL
          </button>
          <button onClick={load} aria-label="Refresh" className="flex items-center justify-center w-10 h-10 bg-white/5 border border-white/10 rounded-lg text-[#859397] hover:text-[#8aebff] transition-all cursor-pointer">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      {/* Summary tiles */}
      <section className="grid grid-cols-3 gap-3">
        {[
          { label: "Tracked", val: bills.length, color: CYAN, icon: <Wallet className="w-4 h-4" /> },
          { label: "Total / cycle", val: `${cur}${fmtAmt(view?.total || 0)}`, color: GREEN, icon: <Wallet className="w-4 h-4" /> },
          { label: "Due soon", val: view?.due_soon ?? 0, color: (view?.due_soon ?? 0) > 0 ? AMBER : GREEN, icon: <CalendarClock className="w-4 h-4" /> },
        ].map((s) => (
          <div key={s.label} className="glass-panel rounded-xl border border-white/5 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xl md:text-2xl font-bold font-mono truncate" style={{ color: s.color }}>{s.val}</div>
              <span style={{ color: s.color }} className="opacity-60">{s.icon}</span>
            </div>
            <div className="text-[9px] font-mono text-[#859397] uppercase tracking-widest mt-1">{s.label}</div>
          </div>
        ))}
      </section>

      {/* Bills list */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[240px] font-mono text-xs text-[#859397] uppercase tracking-widest">
          <RefreshCw className="w-4 h-4 animate-spin mr-3" /> Loading bills…
        </div>
      ) : bills.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[240px] gap-3 text-center">
          <Wallet className="w-10 h-10 text-[#8aebff]/40" />
          <p className="font-mono text-sm text-[#dfe2f3]">No bills tracked yet.</p>
          <p className="font-mono text-xs text-[#859397] max-w-sm">Add one above, or just tell JARVIS: “add electricity ₹1200 due on the 5th every month”.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {bills.map((b) => {
            const c = dueColor(b);
            return (
              <div key={b.id} className="glass-panel rounded-xl border border-white/5 p-4 flex items-center gap-4">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-bold text-[#dfe2f3] truncate">{b.name}</span>
                    <span className="text-[10px] font-mono text-[#859397] uppercase">{b.recurrence}</span>
                  </div>
                  <div className="text-[11px] font-mono mt-0.5 flex items-center gap-1.5" style={{ color: c }}>
                    {b.days_until != null && b.days_until <= 1 && <AlertTriangle className="w-3 h-3" />}
                    {dueLabel(b)}
                  </div>
                </div>
                <div className="text-right font-mono shrink-0">
                  <div className="text-lg font-bold text-[#dfe2f3]">{b.amount ? `${b.currency}${fmtAmt(b.amount)}` : "—"}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => markPaid(b.id)} disabled={busy === b.id} title="Mark this cycle paid"
                    className="px-2.5 py-1.5 rounded text-[10px] font-bold font-mono text-[#5eead4] border border-[#5eead4]/30 hover:bg-[#5eead4]/10 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                    {busy === b.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} PAID
                  </button>
                  <button onClick={() => remove(b.id, b.name)} disabled={busy === b.id} aria-label={`Delete ${b.name}`}
                    className="p-1.5 rounded text-[#859397] hover:text-[#ffb4ab] hover:bg-[#ffb4ab]/5 transition-all cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add bill modal */}
      <AnimatePresence>
        {addOpen && (
          <div className="fixed inset-0 z-[130] flex items-start justify-center pt-[8vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md overflow-y-auto">
            <div className="absolute inset-0" onClick={() => setAddOpen(false)} />
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="relative w-full max-w-md mb-16 bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl">
              <div className="p-6 border-b border-white/10 flex justify-between items-start">
                <h3 className="text-lg font-bold font-mono tracking-wide text-[#8aebff] flex items-center gap-2"><Wallet className="w-5 h-5" /> ADD BILL</h3>
                <button onClick={() => setAddOpen(false)} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white cursor-pointer"><X className="w-4.5 h-4.5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Name <span className="text-[#ffb4ab]">*</span></label>
                  <input value={form.name} autoFocus onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Electricity, Rent, Netflix" className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Amount (₹)</label>
                    <input value={form.amount} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="1200" className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Repeats</label>
                    <select value={form.recurrence} onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value }))} className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 cursor-pointer">
                      <option value="monthly" className="bg-[#0a0e1a]">Monthly</option>
                      <option value="once" className="bg-[#0a0e1a]">One-off</option>
                      <option value="yearly" className="bg-[#0a0e1a]">Yearly</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {form.recurrence === "monthly" ? (
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Due day (1–31)</label>
                      <input value={form.due_day} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, due_day: e.target.value }))} placeholder="5" className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Due date</label>
                      <input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 cursor-pointer" />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Warn (days before)</label>
                    <input value={form.notify_days_before} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, notify_days_before: e.target.value }))} placeholder="3" className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
                  </div>
                </div>
                {err && <p className="text-xs font-mono text-[#ffb4ab]">{err}</p>}
              </div>
              <div className="p-6 pt-0 flex justify-end gap-3">
                <button onClick={() => setAddOpen(false)} className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer">CANCEL</button>
                <button onClick={addBill} disabled={saving} className="px-6 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-50 flex items-center gap-2">
                  {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> ADDING…</> : <><Plus className="w-3.5 h-3.5" /> ADD BILL</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
