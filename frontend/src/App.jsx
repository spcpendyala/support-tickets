import { useState, useCallback, useEffect } from "react"
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import IntegrationsTab from "./Integrations.jsx"

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000"

const CAT_COLORS = {
  billing: { badge: "bg-purple-100 text-purple-800", chart: "#9333ea" },
  technical: { badge: "bg-blue-100 text-blue-800", chart: "#3b82f6" },
  account: { badge: "bg-yellow-100 text-yellow-800", chart: "#eab308" },
  feature_request: { badge: "bg-green-100 text-green-800", chart: "#22c55e" },
  bug: { badge: "bg-red-100 text-red-800", chart: "#ef4444" },
  general: { badge: "bg-gray-100 text-gray-800", chart: "#6b7280" },
}
const PRI_COLORS = {
  critical: { badge: "bg-red-500 text-white", chart: "#ef4444" },
  high: { badge: "bg-orange-400 text-white", chart: "#f97316" },
  medium: { badge: "bg-yellow-400 text-gray-900", chart: "#eab308" },
  low: { badge: "bg-green-400 text-white", chart: "#22c55e" },
}
const PRI_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

const SAMPLE_CSV = `id,subject,body
1,Can't login to my account,"I've been trying to log in for the past hour. Error every time. I have a presentation in 30 minutes!"
2,Unexpected billing charge,"I see a charge I don't recognize. Please explain or refund immediately."
3,Feature request: dark mode,"Many users want dark mode. Please add it to the dashboard."
4,App crashes on iPhone,"The app crashes every time I open it on my iPhone 15. Reinstalling didn't help."
5,How to export my data?,"I need to export all data as CSV. Is this possible?"
6,Possible security breach,"Someone logged into my account from Russia. I did NOT do this. Urgent!"
7,Performance very slow,"Dashboard takes 30+ seconds to load. This is killing my productivity."
8,Upgrade subscription plan,"I'd like to upgrade from Basic to Pro. Can you walk me through it?"`

const Badge = ({ label, cls }) => (
  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cls}`}>
    {label?.replace(/_/g, " ")}
  </span>
)


function WarmupBanner() {
  const [status, setStatus] = useState("checking")
  const [ms, setMs] = useState(null)
  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000"

  useEffect(() => {
    const start = Date.now()
    fetch(`${API_BASE}/health`).then(r => {
      if (r.ok) {
        const elapsed = Date.now() - start
        setMs(elapsed)
        setStatus(elapsed > 3000 ? "slow" : "ready")
      }
    }).catch(() => setStatus("warming"))
    // retry after 5s if still warming
    const t = setTimeout(() => {
      if (status === "checking") setStatus("warming")
    }, 5000)
    return () => clearTimeout(t)
  }, [])

  if (status === "ready" && ms < 3000) return null

  const configs = {
    checking: { bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.2)", color: "#a5b4fc", icon: "⚡", msg: "Checking backend status..." },
    warming:  { bg: "rgba(234,179,8,0.08)",  border: "rgba(234,179,8,0.25)",  color: "#fcd34d", icon: "🔥", msg: "Backend is warming up — first classification may take 30–60 seconds. This is normal for a free-tier server." },
    slow:     { bg: "rgba(234,179,8,0.08)",  border: "rgba(234,179,8,0.25)",  color: "#fcd34d", icon: "⚡", msg: `Backend responded in ${ms}ms — running smoothly now.` },
    ready:    { bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)",  color: "#86efac", icon: "✅", msg: "Backend is live and ready." },
  }
  const c = configs[status]
  return (
    <div className="max-w-xl mx-auto mb-4 rounded-xl px-4 py-3 text-sm flex items-start gap-2" style={{background: c.bg, border: `1px solid ${c.border}`, color: c.color}}>
      <span className="shrink-0">{c.icon}</span>
      <span>{c.msg}</span>
    </div>
  )
}

export default function App() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, subject: "" })
  const [error, setError] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [sortField, setSortField] = useState("priority")
  const [sortDir, setSortDir] = useState("asc")
  const [catFilter, setCatFilter] = useState("all")
  const [priFilter, setPriFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [bulkPriority, setBulkPriority] = useState("")
  const [activeTab, setActiveTab] = useState("table")
  const [mainTab, setMainTab] = useState("classify")

  const classify = async (file) => {
    setFileName(file.name)
    setLoading(true)
    setError(null)
    setTickets([])
    setProgress({ current: 0, total: 0, subject: "" })
    setSelected(new Set())
    const fd = new FormData()
    fd.append("file", file)
    try {
      const response = await fetch(`${API_BASE}/classify/stream`, { method: "POST", body: fd })
      if (!response.ok) throw new Error((await response.json()).detail)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = JSON.parse(line.slice(6))
          if (data.type === "start") setProgress({ current: 0, total: data.total, subject: "" })
          else if (data.type === "progress") setProgress({ current: data.current, total: data.total, subject: data.subject })
          else if (data.type === "ticket") setTickets(prev => [...prev, data.ticket])
          else if (data.type === "done") setLoading(false)
        }
      }
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  const onFile = useCallback((file) => classify(file), [])
  const useSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" })
    classify(new File([blob], "sample_tickets.csv"))
  }

  const handleSort = (f) => {
    if (sortField === f) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortField(f); setSortDir("asc") }
  }

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const applyBulkPriority = () => {
    if (!bulkPriority) return
    setTickets(prev => prev.map(t => selected.has(t.id) ? { ...t, priority: bulkPriority } : t))
    setSelected(new Set())
    setBulkPriority("")
  }

  const exportCSV = () => {
    const h = ["id", "subject", "category", "priority", "sentiment", "confidence", "summary", "tags"]
    const rows = tickets.map(t => h.map(k => `"${(t[k] ?? "").toString().replace(/"/g, '""')}"`).join(","))
    const blob = new Blob([[h.join(","), ...rows].join("\n")], { type: "text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "classified_tickets.csv"
    a.click()
  }

  const sorted = [...tickets].sort((a, b) => {
    let va = a[sortField], vb = b[sortField]
    if (sortField === "priority") { va = PRI_ORDER[va] ?? 9; vb = PRI_ORDER[vb] ?? 9 }
    if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va)
    return sortDir === "asc" ? va - vb : vb - va
  })

  const filtered = sorted.filter(t =>
    (catFilter === "all" || t.category === catFilter) &&
    (priFilter === "all" || t.priority === priFilter) &&
    (search === "" || [t.subject, t.summary, ...(t.tags || [])].join(" ").toLowerCase().includes(search.toLowerCase()))
  )

  const catData = Object.entries(
    tickets.reduce((a, t) => { a[t.category] = (a[t.category] || 0) + 1; return a }, {})
  ).map(([name, value]) => ({ name: name.replace(/_/g, " "), value, color: CAT_COLORS[name]?.chart || "#6b7280" }))

  const priData = ["critical", "high", "medium", "low"].map(p => ({
    name: p, count: tickets.filter(t => t.priority === p).length, color: PRI_COLORS[p]?.chart
  }))

  const SortTh = ({ f, label }) => (
    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase cursor-pointer hover:text-indigo-600 select-none whitespace-nowrap" onClick={() => handleSort(f)}>
      {label} {sortField === f ? (sortDir === "asc" ? "↑" : "↓") : <span className="text-gray-300">↕</span>}
    </th>
  )

  const NavTabs = ({ current, onChange }) => (
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
      <button onClick={() => onChange("classify")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${current === "classify" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
        📋 Classify CSV
      </button>
      <button onClick={() => onChange("integrations")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${current === "integrations" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
        🔌 Integrations
      </button>
    </div>
  )

  // Loading screen
  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex flex-col">
      <header className="bg-white border-b px-8 py-4 flex items-center gap-3 shadow-sm cursor-pointer" onClick={() => { setTickets([]); setFileName(null) }}>
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => { setTickets([]); setFileName(null) }}>
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-lg">🎫</div>
          <div><h1 className="font-bold text-gray-900">TicketAI</h1><p className="text-xs text-gray-400">{fileName}</p></div>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-lg w-full space-y-6 text-center">
          <div className="text-5xl animate-bounce">🤖</div>
          <h2 className="text-2xl font-bold text-gray-900">Classifying tickets...</h2>
          <p className="text-gray-500 text-sm">Processing ticket {progress.current} of {progress.total}</p>
          {progress.subject && <p className="text-indigo-600 font-medium text-sm truncate">"{progress.subject}"</p>}
          <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
          </div>
          <p className="text-xs text-gray-400">{progress.total ? Math.round((progress.current / progress.total) * 100) : 0}% complete</p>
          {tickets.length > 0 && (
            <div className="text-left space-y-2 max-h-64 overflow-y-auto">
              {tickets.map(t => (
                <div key={t.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3 shadow-sm">
                  <Badge label={t.priority} cls={PRI_COLORS[t.priority]?.badge || "bg-gray-200 text-gray-800"} />
                  <span className="text-sm font-medium text-gray-700 truncate">{t.subject}</span>
                  <Badge label={t.category} cls={CAT_COLORS[t.category]?.badge || "bg-gray-100 text-gray-800"} />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )

  // Landing page
  if (tickets.length === 0) return (
    <div className="min-h-screen flex flex-col" style={{fontFamily: "'DM Sans', sans-serif", background: "#0a0a0f"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Syne:wght@700;800&display=swap');
        .hero-glow { background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.35) 0%, transparent 70%); }
        .upload-zone { background: rgba(255,255,255,0.03); border: 1.5px dashed rgba(99,102,241,0.4); transition: all 0.3s; }
        .upload-zone:hover { background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.8); transform: translateY(-2px); }
        .stat-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(10px); }
        .integration-pill { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); transition: all 0.2s; }
        .integration-pill:hover { background: rgba(255,255,255,0.1); border-color: rgba(99,102,241,0.5); }
        .tag-badge { background: rgba(99,102,241,0.15); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.25); }
        .metric-text { background: linear-gradient(135deg, #818cf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .nav-blur { background: rgba(10,10,15,0.8); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.06); }
        .try-btn { background: linear-gradient(135deg, #6366f1, #8b5cf6); transition: all 0.2s; }
        .try-btn:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(99,102,241,0.4); }
        .tab-active { background: rgba(99,102,241,0.2); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3); }
        .tab-inactive { color: rgba(255,255,255,0.4); border: 1px solid transparent; }
        .tab-inactive:hover { color: rgba(255,255,255,0.7); }
        .priority-dot-critical { background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.6); }
        .priority-dot-high { background: #f97316; box-shadow: 0 0 8px rgba(249,115,22,0.6); }
        .priority-dot-medium { background: #eab308; box-shadow: 0 0 8px rgba(234,179,8,0.6); }
        .demo-row { border-bottom: 1px solid rgba(255,255,255,0.06); }
        .demo-row:last-child { border-bottom: none; }
      `}</style>

      <header className="nav-blur sticky top-0 z-50 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{background: "linear-gradient(135deg, #6366f1, #8b5cf6)"}}>🤖</div>
          <div>
            <h1 className="font-bold text-white" style={{fontFamily: "'Syne', sans-serif", fontSize: "1.1rem"}}>TicketAI</h1>
            <p className="text-xs" style={{color: "rgba(255,255,255,0.35)"}}>Support Ticket Classifier</p>
          </div>
        </div>
        <div className="flex gap-1 p-1 rounded-xl" style={{background: "rgba(255,255,255,0.05)"}}>
          {["classify", "integrations"].map(t => (
            <button key={t} onClick={() => setMainTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mainTab === t ? "tab-active" : "tab-inactive"}`}>
              {t === "classify" ? "📋 Classify" : "🔌 Integrations"}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1">
        {mainTab === "integrations" ? (
          <div className="max-w-5xl mx-auto p-8 pt-6">
            <IntegrationsTab onTicketsImported={(t) => { setTickets(t); setFileName("Integration import") }} />
          </div>
        ) : (
          <>
            <section className="hero-glow relative pt-20 pb-16 px-8 text-center overflow-hidden">
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="absolute rounded-full" style={{
                    width: `${300 + i * 150}px`, height: `${300 + i * 150}px`,
                    left: `${20 + i * 25}%`, top: `${-100 + i * 20}px`,
                    background: `radial-gradient(circle, rgba(99,102,241,${0.06 - i * 0.015}) 0%, transparent 70%)`,
                    transform: "translate(-50%, 0)"
                  }} />
                ))}
              </div>
              <div className="relative max-w-3xl mx-auto">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6" style={{background: "rgba(99,102,241,0.15)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)"}}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block"></span>
                  AI-powered · Instant classification · 4 integrations
                </div>
                <h2 className="text-white font-bold mb-4 leading-tight" style={{fontFamily: "'Syne', sans-serif", fontSize: "clamp(2.2rem, 5vw, 3.5rem)"}}>
                  Triage support tickets<br/>
                  <span className="metric-text">in seconds, not hours</span>
                </h2>
                <p className="mb-10 text-lg" style={{color: "rgba(255,255,255,0.5)", maxWidth: "550px", margin: "0 auto 2.5rem"}}>
                  Upload a CSV or connect GitHub, Freshdesk, Linear, or Notion — AI classifies, prioritises, and writes back automatically.
                </p>
                <WarmupBanner />
                <label className="upload-zone block rounded-2xl p-10 cursor-pointer max-w-xl mx-auto mb-4"
                  onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }}>
                  <input type="file" accept=".csv" className="hidden" onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4" style={{background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)"}}>📋</div>
                  <p className="font-semibold text-white text-lg mb-1">Drop your CSV here</p>
                  <p className="text-sm" style={{color: "rgba(255,255,255,0.35)"}}>
                    Supports <code style={{background: "rgba(255,255,255,0.08)", padding: "0.1rem 0.4rem", borderRadius: "4px", color: "#a5b4fc"}}>id, subject, body</code> — auto-detects Kaggle exports
                  </p>
                </label>
                {error && <div className="mt-3 max-w-xl mx-auto rounded-xl p-3 text-sm" style={{background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5"}}>{error}</div>}
                <div className="mt-4">
                  <button onClick={useSample} className="try-btn text-white text-sm font-semibold px-6 py-2.5 rounded-xl">
                    Try with sample data →
                  </button>
                </div>
              </div>
            </section>

            <section className="py-10 px-8 border-y" style={{borderColor: "rgba(255,255,255,0.06)"}}>
              <p className="text-center text-xs font-semibold uppercase tracking-widest mb-6" style={{color: "rgba(255,255,255,0.25)"}}>Connects directly with</p>
              <div className="flex flex-wrap justify-center gap-3 max-w-2xl mx-auto">
                {[
                  {name: "GitHub Issues", icon: "🐙"},
                  {name: "Freshdesk", icon: "🎧"},
                  {name: "Linear", icon: "📐"},
                  {name: "Notion", icon: "📝"},
                  {name: "CSV Upload", icon: "📊"},
                  {name: "Kaggle Export", icon: "🔬"},
                ].map(p => (
                  <div key={p.name} className="integration-pill flex items-center gap-2 px-4 py-2 rounded-full">
                    <span>{p.icon}</span>
                    <span className="text-sm font-medium" style={{color: "rgba(255,255,255,0.7)"}}>{p.name}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="py-16 px-8 max-w-5xl mx-auto">
              <div className="text-center mb-10">
                <h3 className="text-white font-bold text-2xl mb-2" style={{fontFamily: "'Syne', sans-serif"}}>See what TicketAI produces</h3>
                <p style={{color: "rgba(255,255,255,0.4)"}}>Every ticket gets classified, scored, and summarised instantly</p>
              </div>
              <div className="rounded-2xl overflow-hidden" style={{background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)"}}>
                <div className="px-5 py-3 flex items-center gap-2" style={{background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.06)"}}>
                  <div className="w-3 h-3 rounded-full bg-red-500 opacity-60"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500 opacity-60"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500 opacity-60"></div>
                  <span className="ml-3 text-xs" style={{color: "rgba(255,255,255,0.3)"}}>classified_tickets.csv — 8 tickets</span>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-5 gap-4 px-2 py-2 text-xs font-semibold uppercase tracking-wider mb-1" style={{color: "rgba(255,255,255,0.25)"}}>
                    <span>Subject</span><span>Category</span><span>Priority</span><span>Sentiment</span><span>Summary</span>
                  </div>
                  {[
                    {s: "Can't login to my account", cat: "account", pri: "critical", sent: "negative", sum: "User locked out for 2 days, urgent presentation impact"},
                    {s: "Unexpected billing charge", cat: "billing", pri: "high", sent: "negative", sum: "Unrecognised charge, requesting immediate refund"},
                    {s: "Feature request: dark mode", cat: "feature_request", pri: "low", sent: "positive", sum: "User requesting dark mode dashboard option"},
                    {s: "App crashes on iPhone", cat: "bug", pri: "high", sent: "negative", sum: "Crash on launch after latest update, iPhone 15"},
                  ].map((row, i) => (
                    <div key={i} className="demo-row grid grid-cols-5 gap-4 px-2 py-3 items-center">
                      <span className="text-sm truncate" style={{color: "rgba(255,255,255,0.75)"}}>{row.s}</span>
                      <span className="tag-badge text-xs px-2 py-0.5 rounded-full w-fit">{row.cat.replace("_", " ")}</span>
                      <span className="flex items-center gap-1.5 text-sm" style={{color: "rgba(255,255,255,0.6)"}}>
                        <span className={`w-2 h-2 rounded-full priority-dot-${row.pri}`}></span>{row.pri}
                      </span>
                      <span className="text-sm" style={{color: "rgba(255,255,255,0.45)"}}>{row.sent === "negative" ? "😠" : row.sent === "positive" ? "😊" : "😐"} {row.sent}</span>
                      <span className="text-xs truncate" style={{color: "rgba(255,255,255,0.35)"}}>{row.sum}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="py-12 px-8 max-w-4xl mx-auto">
              <div className="grid grid-cols-3 gap-6">
                {[
                  {metric: "73%", label: "Faster first response", sub: "SaaS teams routing critical bugs instantly"},
                  {metric: "500", label: "Tickets in 2 minutes", sub: "vs 4 hours of manual triage"},
                  {metric: "41%", label: "Reduction in churn", sub: "Billing issues caught before escalation"},
                ].map(s => (
                  <div key={s.metric} className="stat-card rounded-2xl p-6 text-center">
                    <p className="metric-text font-bold mb-1" style={{fontFamily: "'Syne', sans-serif", fontSize: "2.5rem"}}>{s.metric}</p>
                    <p className="font-semibold text-white text-sm mb-1">{s.label}</p>
                    <p className="text-xs" style={{color: "rgba(255,255,255,0.35)"}}>{s.sub}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="py-12 px-8 max-w-4xl mx-auto pb-20">
              <h3 className="text-white font-bold text-2xl text-center mb-10" style={{fontFamily: "'Syne', sans-serif"}}>Three steps, zero setup</h3>
              <div className="grid md:grid-cols-3 gap-6">
                {[
                  {step: "01", title: "Upload or Connect", desc: "Drop a CSV or connect GitHub, Freshdesk, Linear, or Notion. Auto-detects column formats including Kaggle exports."},
                  {step: "02", title: "AI Classifies", desc: "Every ticket gets a category, priority, sentiment score, confidence rating, and a one-sentence summary."},
                  {step: "03", title: "Review & Write Back", desc: "Sort, filter, export CSV — or write classifications directly back to your tools with labels and AI comments."},
                ].map(s => (
                  <div key={s.step} className="stat-card rounded-2xl p-6">
                    <p className="font-bold mb-3" style={{fontFamily: "'Syne', sans-serif", fontSize: "1.75rem", background: "linear-gradient(135deg, rgba(99,102,241,0.6), rgba(139,92,246,0.6))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"}}>{s.step}</p>
                    <p className="font-semibold text-white mb-2">{s.title}</p>
                    <p className="text-sm" style={{color: "rgba(255,255,255,0.4)", lineHeight: "1.6"}}>{s.desc}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )

  // Results view
  return (
    <div className="min-h-screen bg-gray-50">
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedTicket(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-bold text-gray-900 text-lg">{selectedTicket.subject}</h3>
              <button onClick={() => setSelectedTicket(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge label={selectedTicket.category} cls={CAT_COLORS[selectedTicket.category]?.badge || "bg-gray-100 text-gray-800"} />
              <Badge label={selectedTicket.priority} cls={PRI_COLORS[selectedTicket.priority]?.badge || "bg-gray-200 text-gray-800"} />
              <span className="text-sm text-gray-500">{selectedTicket.sentiment === "positive" ? "😊" : selectedTicket.sentiment === "negative" ? "😠" : "😐"} {selectedTicket.sentiment}</span>
            </div>
            <p className="text-sm text-gray-600 italic">"{selectedTicket.summary}"</p>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 max-h-40 overflow-y-auto">{selectedTicket.body}</div>
            <div className="flex flex-wrap gap-1">
              {(selectedTicket.tags || []).map(tag => <span key={tag} className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full">{tag}</span>)}
            </div>
            {selectedTicket.source_url && <a href={selectedTicket.source_url} target="_blank" rel="noreferrer" className="text-indigo-600 text-sm hover:underline">View original ↗</a>}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Confidence:</span>
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(selectedTicket.confidence || 0) * 100}%` }} />
              </div>
              <span className="text-xs text-gray-500">{Math.round((selectedTicket.confidence || 0) * 100)}%</span>
            </div>
          </div>
        </div>
      )}
      <header className="bg-white border-b px-8 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => { setTickets([]); setFileName(null) }}>
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-lg">🎫</div>
          <div><h1 className="font-bold text-gray-900">TicketAI</h1><p className="text-xs text-gray-400">{fileName}</p></div>
        </div>
        <div className="flex gap-3 items-center">
          <button onClick={() => { setTickets([]); setFileName(null) }} className="text-sm text-gray-500 hover:text-gray-800">← New Upload</button>
          <button onClick={exportCSV} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">⬇ Export CSV</button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Tickets", value: tickets.length, color: "text-gray-900" },
            { label: "Critical", value: tickets.filter(t => t.priority === "critical").length, color: "text-red-600" },
            { label: "High Priority", value: tickets.filter(t => t.priority === "high").length, color: "text-orange-500" },
            { label: "Categories", value: [...new Set(tickets.map(t => t.category))].length, color: "text-indigo-600" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 uppercase font-medium">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {["table", "analytics"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {tab === "table" ? "📋 Tickets" : "📊 Analytics"}
            </button>
          ))}
        </div>
        {activeTab === "analytics" ? (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Category Breakdown</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-2xl border shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Priority Distribution</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={priData}>
                  <XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>{priData.map((e, i) => <Cell key={i} fill={e.color} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-2xl border shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Sentiment Split</h3>
              <div className="space-y-3">
                {["positive", "neutral", "negative"].map(s => {
                  const count = tickets.filter(t => t.sentiment === s).length
                  const pct = tickets.length ? Math.round((count / tickets.length) * 100) : 0
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <span className="text-lg">{s === "positive" ? "😊" : s === "negative" ? "😠" : "😐"}</span>
                      <span className="text-sm text-gray-600 w-16 capitalize">{s}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s === "positive" ? "bg-green-400" : s === "negative" ? "bg-red-400" : "bg-yellow-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm text-gray-500 w-16 text-right">{count} ({pct}%)</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="bg-white rounded-2xl border shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Top Tags</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(
                  tickets.flatMap(t => t.tags || []).reduce((a, tag) => { a[tag] = (a[tag] || 0) + 1; return a }, {})
                ).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => (
                  <span key={tag} className="bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full">{tag} <span className="font-bold">x{count}</span></span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border p-4 flex flex-wrap gap-4 items-center shadow-sm">
              <input type="text" placeholder="Search subject, summary, tags..." value={search} onChange={e => setSearch(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none w-64" />
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none">
                <option value="all">All Categories</option>
                {[...new Set(tickets.map(t => t.category))].map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
              <select value={priFilter} onChange={e => setPriFilter(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none">
                <option value="all">All Priorities</option>
                {["critical", "high", "medium", "low"].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {selected.size > 0 ? (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-sm text-gray-500">{selected.size} selected</span>
                  <select value={bulkPriority} onChange={e => setBulkPriority(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm outline-none">
                    <option value="">Set priority...</option>
                    {["critical", "high", "medium", "low"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button onClick={applyBulkPriority} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-700">Apply</button>
                  <button onClick={() => setSelected(new Set())} className="text-gray-400 hover:text-gray-600 text-sm">Clear</button>
                </div>
              ) : (
                <span className="ml-auto text-sm text-gray-400">Showing {filtered.length} of {tickets.length}</span>
              )}
            </div>
            <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">
                      <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={e => setSelected(e.target.checked ? new Set(filtered.map(t => t.id)) : new Set())} className="rounded" />
                    </th>
                    <SortTh f="id" label="ID" />
                    <SortTh f="subject" label="Subject" />
                    <SortTh f="category" label="Category" />
                    <SortTh f="priority" label="Priority" />
                    <SortTh f="sentiment" label="Sentiment" />
                    <SortTh f="confidence" label="Confidence" />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Summary</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-50">
                  {filtered.map(t => (
                    <tr key={t.id} className={`hover:bg-indigo-50/30 transition-colors cursor-pointer ${selected.has(t.id) ? "bg-indigo-50" : ""}`}
                      onClick={() => setSelectedTicket(t)}>
                      <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleSelect(t.id) }}>
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => {}} className="rounded" />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 font-mono">{t.id}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-800 max-w-xs truncate">{t.subject}</td>
                      <td className="px-4 py-3"><Badge label={t.category} cls={CAT_COLORS[t.category]?.badge || "bg-gray-100 text-gray-800"} /></td>
                      <td className="px-4 py-3"><Badge label={t.priority} cls={PRI_COLORS[t.priority]?.badge || "bg-gray-200 text-gray-800"} /></td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">{t.sentiment === "positive" ? "😊" : t.sentiment === "negative" ? "😠" : "😐"} {t.sentiment}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(t.confidence || 0) * 100}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{Math.round((t.confidence || 0) * 100)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-sm truncate">{t.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
