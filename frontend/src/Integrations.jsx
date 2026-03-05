import { useState } from "react"

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000"

const INTEGRATIONS = [
  {
    id: "github", name: "GitHub Issues", icon: "🐙",
    color: "border-gray-800",
    desc: "Pull open issues from any repo, write back priority labels and AI comments.",
    fields: [
      { key: "token", label: "Personal Access Token", placeholder: "ghp_xxxxxxxxxxxx", type: "password" },
      { key: "repo", label: "Repository", placeholder: "username/repo-name", type: "text" }
    ]
  },
  {
    id: "freshdesk", name: "Freshdesk", icon: "🎧",
    color: "border-green-500",
    desc: "Pull open tickets, update priority and add private AI notes.",
    fields: [
      { key: "domain", label: "Subdomain", placeholder: "yourcompany", type: "text" },
      { key: "api_key", label: "API Key", placeholder: "your_freshdesk_api_key", type: "password" }
    ]
  },
  {
    id: "linear", name: "Linear", icon: "📐",
    color: "border-violet-500",
    desc: "Pull open issues, update priority fields and add AI classification comments.",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "lin_api_xxxxxxxxxxxx", type: "password" }
    ]
  },
  {
    id: "notion", name: "Notion", icon: "📝",
    color: "border-gray-400",
    desc: "Pull rows from a Notion database, write back Priority, Category and AI Summary.",
    fields: [
      { key: "api_key", label: "Integration Token", placeholder: "secret_xxxxxxxxxxxx", type: "password" },
      { key: "database_id", label: "Database ID", placeholder: "32-char ID from URL", type: "text" }
    ]
  },
]

const PRI_COLORS = {
  critical: "bg-red-500 text-white",
  high: "bg-orange-400 text-white",
  medium: "bg-yellow-400 text-gray-900",
  low: "bg-green-400 text-white",
}

const CAT_COLORS = {
  billing: "bg-purple-100 text-purple-800",
  technical: "bg-blue-100 text-blue-800",
  account: "bg-yellow-100 text-yellow-800",
  feature_request: "bg-green-100 text-green-800",
  bug: "bg-red-100 text-red-800",
  general: "bg-gray-100 text-gray-800",
}

const Badge = ({ label, cls }) => (
  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cls}`}>
    {label?.replace(/_/g, " ")}
  </span>
)

export default function IntegrationsTab({ onTicketsImported }) {
  const [creds, setCreds] = useState({})
  const [importing, setImporting] = useState(null)
  const [writingBack, setWritingBack] = useState(null)
  const [imported, setImported] = useState({})
  const [classified, setClassified] = useState({})
  const [status, setStatus] = useState({})

  const updateCred = (platform, key, val) =>
    setCreds(p => ({ ...p, [platform]: { ...(p[platform] || {}), [key]: val } }))

  const importTickets = async (platform) => {
    setImporting(platform)
    setStatus(p => ({ ...p, [platform]: "Importing..." }))
    try {
      const c = creds[platform] || {}
      const params = new URLSearchParams({ ...c, limit: 20 })
      const r = await fetch(`${API_BASE}/integrations/${platform}/import?${params}`)
      if (!r.ok) throw new Error((await r.json()).detail)
      const tickets = await r.json()
      setImported(p => ({ ...p, [platform]: tickets }))
      setStatus(p => ({ ...p, [platform]: `✅ ${tickets.length} tickets imported` }))
    } catch (e) {
      setStatus(p => ({ ...p, [platform]: `❌ ${e.message}` }))
    } finally {
      setImporting(null)
    }
  }

  const classifyImported = async (platform) => {
    const tickets = imported[platform] || []
    if (!tickets.length) return
    const results = []
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i]
      setStatus(p => ({ ...p, [platform]: `Classifying ${i + 1}/${tickets.length}: ${t.subject}` }))
      const blob = new Blob(
        [`id,subject,body\n"${t.id}","${t.subject.replace(/"/g, '""')}","${t.body.replace(/"/g, '""')}"`],
        { type: "text/csv" }
      )
      const fd = new FormData()
      fd.append("file", new File([blob], "ticket.csv"))
      try {
        const r = await fetch(`${API_BASE}/classify/stream`, { method: "POST", body: fd })
        const reader = r.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          for (const line of buf.split("\n")) {
            if (!line.startsWith("data: ")) continue
            const data = JSON.parse(line.slice(6))
            if (data.type === "ticket") results.push({ ...data.ticket, source_url: t.source_url })
          }
          buf = buf.split("\n").pop()
        }
      } catch (e) { /* skip */ }
      if (i < tickets.length - 1) await new Promise(r => setTimeout(r, 10000))
    }
    setClassified(p => ({ ...p, [platform]: results }))
    setStatus(p => ({ ...p, [platform]: `✅ ${results.length} classified — ready to write back` }))
  }

  const writeback = async (platform) => {
    const tickets = classified[platform] || []
    if (!tickets.length) return
    setWritingBack(platform)
    setStatus(p => ({ ...p, [platform]: `Writing back to ${platform}...` }))
    try {
      const c = creds[platform] || {}
      const params = new URLSearchParams(c)
      const r = await fetch(`${API_BASE}/integrations/${platform}/writeback?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tickets),
      })
      if (!r.ok) throw new Error((await r.json()).detail)
      const result = await r.json()
      setStatus(p => ({ ...p, [platform]: `✅ Written back ${result.written} tickets to ${platform}` }))
    } catch (e) {
      setStatus(p => ({ ...p, [platform]: `❌ ${e.message}` }))
    } finally {
      setWritingBack(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-sm text-indigo-700">
        <strong>How it works:</strong> Connect a platform → Import tickets → AI classifies them → Write classifications back automatically.
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        {INTEGRATIONS.map(intg => {
          const imp = imported[intg.id] || []
          const cls = classified[intg.id] || []
          const st = status[intg.id] || ""
          return (
            <div key={intg.id} className={`bg-white rounded-2xl border-2 ${intg.color} shadow-sm p-6 space-y-4`}>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{intg.icon}</span>
                <div>
                  <h3 className="font-bold text-gray-900">{intg.name}</h3>
                  <p className="text-xs text-gray-500">{intg.desc}</p>
                </div>
              </div>
              <div className="space-y-2">
                {intg.fields.map(f => (
                  <input key={f.key} type={f.type}
                    placeholder={`${f.label}: ${f.placeholder}`}
                    value={(creds[intg.id] || {})[f.key] || ""}
                    onChange={e => updateCred(intg.id, f.key, e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 outline-none font-mono"
                  />
                ))}
              </div>
              {st && (
                <p className={`text-xs px-3 py-2 rounded-lg ${st.startsWith("❌") ? "bg-red-50 text-red-600" : "bg-gray-50 text-gray-600"}`}>
                  {st}
                </p>
              )}
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => importTickets(intg.id)} disabled={importing === intg.id}
                  className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-gray-700 disabled:opacity-40 transition-colors">
                  {importing === intg.id ? "Importing..." : "Import Tickets"}
                </button>
                {imp.length > 0 && cls.length === 0 && (
                  <button onClick={() => classifyImported(intg.id)}
                    className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-700 transition-colors">
                    Classify {imp.length} Tickets
                  </button>
                )}
                {cls.length > 0 && (
                  <>
                    <button onClick={() => writeback(intg.id)} disabled={writingBack === intg.id}
                      className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-green-700 disabled:opacity-40 transition-colors">
                      {writingBack === intg.id ? "Writing..." : `Write Back ${cls.length} Results`}
                    </button>
                    <button onClick={() => onTicketsImported(cls)}
                      className="border border-indigo-300 text-indigo-600 px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-50 transition-colors">
                      View in Dashboard
                    </button>
                  </>
                )}
              </div>
              {imp.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {imp.slice(0, 5).map(t => (
                    <div key={t.id} className="text-xs text-gray-500 truncate flex items-center gap-2">
                      <span className="text-gray-300">#{t.id}</span>
                      <span className="truncate">{t.subject}</span>
                      {t.source_url && (
                        <a href={t.source_url} target="_blank" rel="noreferrer"
                          className="text-indigo-400 hover:underline ml-auto shrink-0">↗</a>
                      )}
                    </div>
                  ))}
                  {imp.length > 5 && <p className="text-xs text-gray-400">+{imp.length - 5} more</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
