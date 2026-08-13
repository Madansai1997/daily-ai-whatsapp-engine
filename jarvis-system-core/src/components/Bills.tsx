import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  RefreshCw,
  Plus,
  X,
  Wallet,
  CheckCircle2,
  Trash2,
  CalendarClock,
  AlertTriangle,
  ArrowRightLeft,
  DollarSign,
  Users,
  CreditCard,
  TrendingDown
} from "lucide-react";

interface Bill {
  id: number;
  name: string;
  amount: number;
  currency: string;
  recurrence: "monthly" | "once" | "yearly";
  due_day?: number | null;
  due_date?: string | null;
  category?: string | null; // "bill" | "debt"
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

const CYAN = "#8aebff", AMBER = "#ffd6a3", GREEN = "#5eead4", RED = "#ffb4ab", PURPLE = "#c084fc";

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

  // Filter Category: 'all' | 'bills' | 'debts'
  const [filterTab, setFilterTab] = useState<"all" | "bills" | "debts">("all");

  // Live FX Rate (USD -> INR)
  const [fxRate, setFxRate] = useState<number>(87.20);
  const [fxLoading, setFxLoading] = useState(false);

  // Quick Currency Calculator State
  const [calcUsd, setCalcUsd] = useState<string>("100");
  const [calcInr, setCalcInr] = useState<string>("8720");

  const empty = {
    name: "",
    amount: "",
    currency: "₹",
    category: "bill",
    recurrence: "monthly",
    due_day: "",
    due_date: "",
    notify_days_before: "3"
  };
  const [form, setForm] = useState({ ...empty });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, fxRes] = await Promise.all([
        fetch("/api/bills", { cache: "no-store" }),
        fetch("/api/bills/fx-rate", { cache: "no-store" })
      ]);

      if (bRes.ok) setView(await bRes.json());
      if (fxRes.ok) {
        const fxData = await fxRes.json();
        if (fxData.usd_to_inr) {
          setFxRate(fxData.usd_to_inr);
          setCalcInr((100 * fxData.usd_to_inr).toFixed(0));
        }
      }
    } catch {
      /* keep */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Handle calculator input
  const handleCalcUsdChange = (val: string) => {
    setCalcUsd(val);
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setCalcInr((num * fxRate).toFixed(2));
    } else {
      setCalcInr("");
    }
  };

  const handleCalcInrChange = (val: string) => {
    setCalcInr(val);
    const num = parseFloat(val);
    if (!isNaN(num) && fxRate > 0) {
      setCalcUsd((num / fxRate).toFixed(2));
    } else {
      setCalcUsd("");
    }
  };

  const addBill = async () => {
    if (!form.name.trim()) { setErr("Give the item or person a name."); return; }
    if (form.recurrence === "monthly" && !form.due_day) { setErr("Which day of the month is it due?"); return; }
    if (form.recurrence !== "monthly" && !form.due_date) { setErr("Pick the target due date."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/bills", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          amount: parseFloat(form.amount) || 0,
          currency: form.currency,
          category: form.category,
          recurrence: form.recurrence,
          due_day: form.due_day ? parseInt(form.due_day) : null,
          due_date: form.due_date || null,
          notify_days_before: parseInt(form.notify_days_before) || 3,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      setAddOpen(false); setForm({ ...empty }); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  const markPaid = async (id: number) => {
    setBusy(id);
    try { await fetch(`/api/bills/${id}/paid`, { method: "POST" }); await load(); }
    finally { setBusy(null); }
  };

  const remove = async (id: number, name: string) => {
    if (!confirm(`Remove "${name}" from tracking?`)) return;
    setBusy(id);
    try { await fetch(`/api/bills/${id}/delete`, { method: "POST" }); await load(); }
    finally { setBusy(null); }
  };

  const allBills = view?.bills || [];
  const filteredBills = allBills.filter((b) => {
    if (filterTab === "bills") return (b.category || "bill").toLowerCase() === "bill";
    if (filterTab === "debts") return (b.category || "").toLowerCase() === "debt";
    return true;
  });

  // Calculate totals in both INR and USD
  let totalInr = 0;
  let totalUsd = 0;
  let debtsInr = 0;
  let debtsUsd = 0;

  allBills.forEach((b) => {
    const amt = b.amount || 0;
    const isUsd = b.currency === "$" || b.currency === "USD";
    const isDebt = (b.category || "").toLowerCase() === "debt";

    if (isUsd) {
      totalUsd += amt;
      totalInr += amt * fxRate;
      if (isDebt) {
        debtsUsd += amt;
        debtsInr += amt * fxRate;
      }
    } else {
      totalInr += amt;
      totalUsd += fxRate > 0 ? amt / fxRate : 0;
      if (isDebt) {
        debtsInr += amt;
        debtsUsd += fxRate > 0 ? amt / fxRate : 0;
      }
    }
  });

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.4 }} className="space-y-6 text-zinc-100">
      {/* Header */}
      <section className="pt-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
            <span className="opacity-40 font-light text-xl">05 //</span> BILLS, DEBTS &amp; LIABILITIES
          </h1>
          <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
            Recurring bills · Debts owed to people · Dual $ USD &amp; ₹ INR conversion
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <button onClick={() => { setForm({ ...empty }); setErr(""); setAddOpen(true); }} className="flex items-center gap-2 px-5 py-2 bg-[#8aebff]/10 border border-[#8aebff]/30 rounded-lg text-xs font-semibold hover:bg-[#8aebff]/20 transition-all text-[#8aebff] cursor-pointer">
            <Plus className="w-4 h-4" /> ADD BILL / DEBT
          </button>
          <button onClick={load} aria-label="Refresh" className="flex items-center justify-center w-10 h-10 bg-white/5 border border-white/10 rounded-lg text-[#859397] hover:text-[#8aebff] transition-all cursor-pointer">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      {/* LIVE FX CONVERTER STRIP */}
      <section className="p-4 glass-panel rounded-2xl border border-amber-500/30 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
            <ArrowRightLeft className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold font-mono text-zinc-100 uppercase">Live FX Rate:</span>
              <span className="text-xs font-bold font-mono px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-md">
                $1 USD = ₹{fxRate.toFixed(2)} INR
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-mono mt-0.5">Auto-converts all USD ($) entries into Indian Rupees (₹) in real time.</p>
          </div>
        </div>

        {/* QUICK CALCULATOR */}
        <div className="flex items-center gap-2 bg-zinc-950/80 border border-zinc-800 px-3 py-1.5 rounded-xl">
          <span className="text-xs font-mono text-cyan-400 font-bold">$</span>
          <input
            type="number"
            value={calcUsd}
            onChange={(e) => handleCalcUsdChange(e.target.value)}
            className="w-20 bg-transparent text-xs font-mono text-zinc-100 focus:outline-none border-b border-zinc-700 focus:border-cyan-400"
            placeholder="USD"
          />
          <span className="text-xs text-zinc-500 font-mono">⇄</span>
          <span className="text-xs font-mono text-emerald-400 font-bold">₹</span>
          <input
            type="number"
            value={calcInr}
            onChange={(e) => handleCalcInrChange(e.target.value)}
            className="w-24 bg-transparent text-xs font-mono text-zinc-100 focus:outline-none border-b border-zinc-700 focus:border-emerald-400"
            placeholder="INR"
          />
        </div>
      </section>

      {/* Summary tiles */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-panel rounded-xl border border-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xl md:text-2xl font-bold font-mono truncate text-[#8aebff]">
              ₹{fmtAmt(totalInr)}
            </div>
            <Wallet className="w-4 h-4 text-[#8aebff] opacity-60" />
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
            ≈ ${fmtAmt(totalUsd)} USD
          </div>
          <div className="text-[9px] font-mono text-[#859397] uppercase tracking-widest mt-1">Total Monthly Commitments</div>
        </div>

        <div className="glass-panel rounded-xl border border-purple-500/20 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xl md:text-2xl font-bold font-mono truncate text-purple-400">
              ₹{fmtAmt(debtsInr)}
            </div>
            <Users className="w-4 h-4 text-purple-400 opacity-60" />
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
            ≈ ${fmtAmt(debtsUsd)} USD
          </div>
          <div className="text-[9px] font-mono text-purple-300 uppercase tracking-widest mt-1">Debts Owed to People</div>
        </div>

        <div className="glass-panel rounded-xl border border-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xl md:text-2xl font-bold font-mono truncate text-emerald-400">
              {allBills.length}
            </div>
            <CreditCard className="w-4 h-4 text-emerald-400 opacity-60" />
          </div>
          <div className="text-[9px] font-mono text-[#859397] uppercase tracking-widest mt-1">Total Items Tracked</div>
        </div>

        <div className="glass-panel rounded-xl border border-white/5 p-4">
          <div className="flex items-center justify-between">
            <div className={`text-xl md:text-2xl font-bold font-mono truncate ${view?.due_soon ? "text-[#ffd6a3]" : "text-emerald-400"}`}>
              {view?.due_soon ?? 0}
            </div>
            <CalendarClock className="w-4 h-4 text-[#ffd6a3] opacity-60" />
          </div>
          <div className="text-[9px] font-mono text-[#859397] uppercase tracking-widest mt-1">Due Soon (Next 3 Days)</div>
        </div>
      </section>

      {/* FILTER TABS */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2 font-mono">
        {[
          { id: "all", label: "ALL ITEMS", count: allBills.length },
          { id: "bills", label: "RECURRING BILLS & SUBS", count: allBills.filter((b) => (b.category || "bill").toLowerCase() === "bill").length },
          { id: "debts", label: "DEBTS OWED TO PEOPLE", count: allBills.filter((b) => (b.category || "").toLowerCase() === "debt").length }
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setFilterTab(t.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all cursor-pointer flex items-center gap-2 ${
              filterTab === t.id
                ? "bg-[#8aebff]/15 text-[#8aebff] border border-[#8aebff]/40 shadow-sm"
                : "bg-zinc-900/40 border border-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.label}
            <span className="text-[10px] px-1.5 py-0.2 bg-zinc-950 rounded-full font-bold">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Bills / Debts list */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[240px] font-mono text-xs text-[#859397] uppercase tracking-widest">
          <RefreshCw className="w-4 h-4 animate-spin mr-3" /> Loading commitments…
        </div>
      ) : filteredBills.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[240px] gap-3 text-center">
          <Wallet className="w-10 h-10 text-[#8aebff]/40" />
          <p className="font-mono text-sm text-[#dfe2f3]">No items in this category.</p>
          <p className="font-mono text-xs text-[#859397] max-w-sm">Click "+ ADD BILL / DEBT" to track what you owe.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredBills.map((b) => {
            const c = dueColor(b);
            const isUsd = b.currency === "$" || b.currency === "USD";
            const isDebt = (b.category || "").toLowerCase() === "debt";
            const convertedInr = isUsd ? (b.amount || 0) * fxRate : null;
            const convertedUsd = !isUsd && fxRate > 0 ? (b.amount || 0) / fxRate : null;

            return (
              <div key={b.id} className="glass-panel rounded-xl border border-white/5 p-4 flex items-center gap-4 hover:border-amber-500/20 transition-all">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-[#dfe2f3] truncate">{b.name}</span>
                    {isDebt ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded uppercase font-bold">
                        Debt to Person
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded uppercase">
                        {b.recurrence}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono mt-0.5 flex items-center gap-1.5" style={{ color: c }}>
                    {b.days_until != null && b.days_until <= 1 && <AlertTriangle className="w-3 h-3" />}
                    {dueLabel(b)}
                  </div>
                </div>

                {/* DUAL CURRENCY DISPLAY */}
                <div className="text-right font-mono shrink-0">
                  <div className="text-lg font-bold text-[#dfe2f3]">
                    {b.amount ? `${b.currency}${fmtAmt(b.amount)}` : "—"}
                  </div>
                  {b.amount ? (
                    <div className="text-[11px] font-semibold text-amber-400/90 font-mono">
                      {isUsd ? `≈ ₹${fmtAmt(convertedInr || 0)}` : `≈ $${fmtAmt(convertedUsd || 0)}`}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => markPaid(b.id)} disabled={busy === b.id} title="Mark this paid / cleared"
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

      {/* Add bill / debt modal */}
      <AnimatePresence>
        {addOpen && (
          <div className="fixed inset-0 z-[130] flex items-start justify-center pt-[8vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md overflow-y-auto">
            <div className="absolute inset-0" onClick={() => setAddOpen(false)} />
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="relative w-full max-w-md mb-16 bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl">
              <div className="p-6 border-b border-white/10 flex justify-between items-start">
                <h3 className="text-lg font-bold font-mono tracking-wide text-[#8aebff] flex items-center gap-2"><Wallet className="w-5 h-5" /> ADD COMMITMENT</h3>
                <button onClick={() => setAddOpen(false)} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white cursor-pointer"><X className="w-4.5 h-4.5" /></button>
              </div>
              <div className="p-6 space-y-4">
                {/* Category Selection: Bill vs Debt */}
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Category</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, category: "bill" }))}
                      className={`py-2 px-3 rounded-lg text-xs font-mono font-bold transition-all ${
                        form.category === "bill" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "bg-zinc-900 border border-zinc-800 text-zinc-400"
                      }`}
                    >
                      💳 Recurring Bill
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, category: "debt", recurrence: "once" }))}
                      className={`py-2 px-3 rounded-lg text-xs font-mono font-bold transition-all ${
                        form.category === "debt" ? "bg-purple-500/20 text-purple-300 border border-purple-500/40" : "bg-zinc-900 border border-zinc-800 text-zinc-400"
                      }`}
                    >
                      🤝 Debt Owed to Person
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                    {form.category === "debt" ? "Person / Reason Owed" : "Bill Name"} <span className="text-[#ffb4ab]">*</span>
                  </label>
                  <input value={form.name} autoFocus onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={form.category === "debt" ? "e.g. John (Borrowed for laptop), Alex" : "e.g. Electricity, Rent, AWS"} className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Amount</label>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={form.currency}
                        onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                        className="bg-[#0a0e1a]/80 border border-white/10 rounded-lg px-2 py-2.5 font-mono text-sm text-amber-400 font-bold focus:outline-none focus:border-amber-400"
                      >
                        <option value="₹">₹ (INR)</option>
                        <option value="$">$ (USD)</option>
                        <option value="AED">AED</option>
                        <option value="€">€ (EUR)</option>
                      </select>
                      <input value={form.amount} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="500" className="flex-1 bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
                    </div>
                    {form.amount && (form.currency === "$" || form.currency === "USD") ? (
                      <span className="text-[10px] font-mono text-amber-400 block mt-1">
                        ≈ ₹{((parseFloat(form.amount) || 0) * fxRate).toLocaleString()} INR
                      </span>
                    ) : null}
                  </div>

                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Repeats</label>
                    <select value={form.recurrence} onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value as any }))} className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 cursor-pointer">
                      <option value="once" className="bg-[#0a0e1a]">One-off (Target Date)</option>
                      <option value="monthly" className="bg-[#0a0e1a]">Monthly</option>
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
                  {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> SAVING…</> : <><Plus className="w-3.5 h-3.5" /> SAVE COMMITMENT</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
