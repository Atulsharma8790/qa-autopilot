'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LOOP_STEPS } from '@/lib/prompts'

type JiraCredentials = { baseUrl: string; email: string; token: string; projectKey: string }
type PushedTicket    = { key: string; url: string; title: string }
type FailedTicket    = { title: string; error: string }

type Classification = { testName: string; classification: string; confidence: string; reason: string }
type RootCause      = { testName: string; hypothesis: string; evidence: string; affectedArea: string }
type Cluster        = { clusterId: string; clusterTitle: string; rootCause: string; affectedTests: string[]; severity: string }
type JiraTicket     = { clusterId: string; jiraTitle: string; type: string; severity: string; stepsToReproduce: string[]; expectedBehaviour: string; actualBehaviour: string; affectedTests: string[]; suggestedFix: string; labels: string[] }
type SelfReview     = { totalFailures: number; classified: number; realBugs: number; flaky: number; envIssues: number; infraIssues: number; clustersCreated: number; ticketsGenerated: number; missedFailures: string[]; consistencyIssues: string[]; verdict: string; verdictNote: string }

type StepData = {
  1?: Classification[]
  2?: RootCause[]
  3?: Cluster[]
  4?: JiraTicket[]
  5?: SelfReview
}

const SEV: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
}
const CLASS_COLOR: Record<string, string> = {
  'real-bug':  'bg-red-500/20 text-red-400',
  'flaky':     'bg-yellow-500/20 text-yellow-400',
  'env-issue': 'bg-orange-500/20 text-orange-400',
  'infra':     'bg-purple-500/20 text-purple-400',
}

export default function AnalyzePage() {
  const router = useRouter()
  const [activeStep, setActiveStep]    = useState(0)
  const [completedSteps, setCompleted] = useState<number[]>([])
  const [stepData, setStepData]        = useState<StepData>({})
  const [done, setDone]                = useState(false)
  const [error, setError]              = useState('')
  const [copied, setCopied]            = useState(false)

  // Tab navigation: null = auto-follow active step, number = user pinned to this step
  const [pinnedTab, setPinnedTab]      = useState<number | null>(null)

  // JIRA push state
  const [jiraCreds, setJiraCreds]      = useState<JiraCredentials>({ baseUrl: '', email: '', token: '', projectKey: '' })
  const [jiraConnected, setJiraConnected] = useState(false)
  const [showJiraForm, setShowJiraForm]   = useState(false)
  const [pushing, setPushing]          = useState(false)
  const [pushResult, setPushResult]    = useState<{ created: PushedTicket[]; failed: FailedTicket[] } | null>(null)
  const [pushErr, setPushErr]          = useState('')

  // Inline ticket editing
  const [editingIdx, setEditingIdx]    = useState<number | null>(null)
  const [editDrafts, setEditDrafts]    = useState<Record<number, JiraTicket>>({})

  // Attachment upload
  const [attachingKey, setAttachingKey]       = useState<string | null>(null)
  const [attachUploading, setAttachUploading] = useState(false)
  const [attachResults, setAttachResults]     = useState<Record<string, string[]>>({})
  const [attachErr, setAttachErr]             = useState<Record<string, string>>({})
  const attachFileRef = useRef<HTMLInputElement>(null)

  // Token streaming goes directly to DOM — no useState, no re-renders
  const liveBoxRefs   = useRef<Record<number, HTMLPreElement | null>>({})
  const liveTextAccum = useRef<Record<number, string>>({})
  const sseBuffer     = useRef('')
  const abortRef      = useRef<AbortController | null>(null)

  // displayTab: follow active step unless user has pinned a tab
  const displayTab = pinnedTab ?? activeStep

  useEffect(() => {
    const failures = sessionStorage.getItem('qa_failures')
    if (!failures) { router.push('/'); return }
    runLoop(failures)
    try {
      const saved = sessionStorage.getItem('qa_jira')
      if (saved) {
        const creds = JSON.parse(saved) as JiraCredentials
        setJiraCreds(creds)
        setJiraConnected(true)
      }
    } catch { /* ignore */ }
    return () => abortRef.current?.abort()
  }, [])

  const pushToJira = useCallback(async (tickets: JiraTicket[], creds: JiraCredentials) => {
    setPushing(true); setPushErr(''); setPushResult(null)
    const res = await fetch('/api/push-jira', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...creds, tickets }),
    })
    const data = await res.json()
    if (res.ok) {
      setPushResult({ created: data.created, failed: data.failed })
      sessionStorage.setItem('qa_jira', JSON.stringify(creds))
      setJiraConnected(true)
    } else {
      setPushErr(data.error ?? 'Push failed')
    }
    setPushing(false)
  }, [])

  async function attachToJira(issueKey: string, file: File) {
    setAttachUploading(true)
    setAttachErr(p => ({ ...p, [issueKey]: '' }))
    const creds = jiraCreds
    const form = new FormData()
    form.append('baseUrl', creds.baseUrl)
    form.append('email', creds.email)
    form.append('token', creds.token)
    form.append('issueKey', issueKey)
    form.append('file', file)
    const res = await fetch('/api/attach-jira', { method: 'POST', body: form })
    const data = await res.json()
    if (res.ok) {
      setAttachResults(p => ({ ...p, [issueKey]: [...(p[issueKey] ?? []), data.filename] }))
      setAttachingKey(null)
    } else {
      setAttachErr(p => ({ ...p, [issueKey]: data.error ?? 'Upload failed' }))
    }
    setAttachUploading(false)
  }

  async function runLoop(failures: string) {
    abortRef.current = new AbortController()
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failures }),
        signal: abortRef.current.signal,
      })

      const reader = res.body!.getReader()
      const dec = new TextDecoder()

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break

        // Buffer to handle SSE messages split across chunks
        sseBuffer.current += dec.decode(value, { stream: true })
        const parts = sseBuffer.current.split('\n\n')
        sseBuffer.current = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'step_start') {
              setActiveStep(data.step)
              // pinnedTab === null means "follow active" — keeps auto-advancing
              // If user pinned a completed step, leave them there; don't yank away
            }

            if (data.type === 'token') {
              const s = data.step ?? 0
              liveTextAccum.current[s] = (liveTextAccum.current[s] ?? '') + data.text
              const el = liveBoxRefs.current[s]
              if (el) {
                el.textContent += data.text
                const container = el.parentElement
                if (container) container.scrollTop = container.scrollHeight
              }
            }

            if (data.type === 'step_result') {
              const s = data.step as 1 | 2 | 3 | 4 | 5
              setStepData(prev => ({ ...prev, [s]: data.data }))
              setCompleted(prev => prev.includes(s) ? prev : [...prev, s])
            }

            if (data.type === 'complete') {
              setDone(true)
              setActiveStep(0)
              // Land on Self-Review if user hasn't pinned somewhere specific
              setPinnedTab(prev => prev !== null ? prev : 5)
            }

            if (data.type === 'error') setError(data.message)
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    }
  }

  function saveTicketEdit(idx: number) {
    const draft = editDrafts[idx]
    if (!draft) return
    setStepData(prev => {
      const tickets = [...(prev[4] ?? [])] as JiraTicket[]
      tickets[idx] = draft
      return { ...prev, 4: tickets }
    })
    setEditingIdx(null)
  }

  function startEdit(idx: number, ticket: JiraTicket) {
    setEditDrafts(p => ({ ...p, [idx]: { ...ticket, stepsToReproduce: [...ticket.stepsToReproduce] } }))
    setEditingIdx(idx)
  }

  function exportMarkdown() {
    let md = `# QA Autopilot — Triage Report\n\n`
    const s5 = stepData[5] as SelfReview | undefined
    if (s5) md += `## Summary\n- Total: ${s5.totalFailures} | Real Bugs: ${s5.realBugs} | Flaky: ${s5.flaky} | Env: ${s5.envIssues}\n- Clusters: ${s5.clustersCreated} | JIRA Tickets: ${s5.ticketsGenerated}\n\n`
    const s4 = stepData[4] as JiraTicket[] | undefined
    if (Array.isArray(s4)) {
      md += `## JIRA Tickets\n`
      s4.forEach(t => {
        md += `\n### [${t.severity?.toUpperCase()}] ${t.jiraTitle}\n`
        md += `**Steps:** ${t.stepsToReproduce?.join(' → ')}\n**Expected:** ${t.expectedBehaviour}\n**Actual:** ${t.actualBehaviour}\n**Fix:** ${t.suggestedFix}\n`
      })
    }
    const blob = new Blob([md], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'triage-report.md'; a.click()
  }

  function copyTickets() {
    const s4 = stepData[4] as JiraTicket[] | undefined
    if (!Array.isArray(s4)) return
    navigator.clipboard.writeText(s4.map(t => `[${t.severity?.toUpperCase()}] ${t.jiraTitle}\n${t.stepsToReproduce?.join('\n')}`).join('\n\n---\n\n'))
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const s5 = stepData[5] as SelfReview | undefined
  const step4NeedsAction = completedSteps.includes(4) && !pushResult

  // ── STEP CONTENT RENDERER ─────────────────────────────────────────────────
  function StepContent({ stepNum }: { stepNum: number }) {
    const isComplete = completedSteps.includes(stepNum)
    const isActive   = activeStep === stepNum

    if (!isComplete && !isActive) {
      return (
        <div className="text-center py-16 text-slate-600">
          <p className="text-4xl mb-3">⏳</p>
          <p>Waiting for loop to reach this step...</p>
        </div>
      )
    }

    // Live stream — tokens written directly to DOM, zero React re-renders
    if (isActive && !isComplete) {
      return (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-block w-3 h-3 rounded-full bg-rose-500 blink" />
            <span className="text-rose-400 font-bold text-sm">Agent is working on this step...</span>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-64 overflow-y-auto">
            <pre
              ref={el => { liveBoxRefs.current[stepNum] = el }}
              className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed"
            />
            <span className="inline-block w-2 h-4 bg-rose-500 blink ml-0.5 align-text-bottom" />
          </div>
          <p className="text-slate-600 text-xs mt-2">Live output from Claude — structured results appear when this step completes</p>
        </div>
      )
    }

    // ── Step 1: Classifications ──
    if (stepNum === 1) {
      const data = stepData[1]
      if (!Array.isArray(data)) return <RawFallback tokens={liveTextAccum.current[stepNum] ?? ''} />
      return (
        <div className="space-y-2 fade-slide-in">
          <div className="flex gap-3 mb-4 flex-wrap">
            {['real-bug','flaky','env-issue','infra'].map(c => (
              <span key={c} className={`text-xs px-2 py-1 rounded-lg font-bold ${CLASS_COLOR[c]}`}>
                {c}: {data.filter(d => d.classification === c).length}
              </span>
            ))}
          </div>
          {data.map((item, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-4">
              <span className={`text-xs font-bold px-2 py-1 rounded-lg shrink-0 ${CLASS_COLOR[item.classification] ?? 'bg-slate-700 text-slate-300'}`}>{item.classification}</span>
              <div className="flex-1 min-w-0">
                <p className="text-slate-200 text-sm font-mono truncate">{item.testName}</p>
                <p className="text-slate-400 text-xs mt-1">{item.reason}</p>
              </div>
              <span className="text-xs text-slate-600 shrink-0 mt-1">{item.confidence}</span>
            </div>
          ))}
        </div>
      )
    }

    // ── Step 2: Root Causes ──
    if (stepNum === 2) {
      const data = stepData[2]
      if (!Array.isArray(data)) return <RawFallback tokens={liveTextAccum.current[stepNum] ?? ''} />
      return (
        <div className="space-y-3 fade-slide-in">
          {data.map((item, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <p className="text-slate-400 text-xs font-mono mb-2">{item.testName}</p>
              <p className="text-white font-semibold mb-3">{item.hypothesis}</p>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-slate-500 text-xs mb-1">Evidence</p>
                  <p className="text-slate-300 text-sm">{item.evidence}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-slate-500 text-xs mb-1">Affected Area</p>
                  <p className="text-rose-400 text-sm font-medium">{item.affectedArea}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )
    }

    // ── Step 3: Clusters ──
    if (stepNum === 3) {
      const data = stepData[3]
      if (!Array.isArray(data)) return <RawFallback tokens={liveTextAccum.current[stepNum] ?? ''} />
      return (
        <div className="space-y-3 fade-slide-in">
          {data.map((cluster, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <span className="text-rose-400 text-xs font-mono mr-2">{cluster.clusterId}</span>
                  <span className="text-white font-bold">{cluster.clusterTitle}</span>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded-lg border shrink-0 ${SEV[cluster.severity] ?? SEV.medium}`}>{cluster.severity}</span>
              </div>
              <p className="text-slate-400 text-sm mb-3">{cluster.rootCause}</p>
              <div className="flex flex-wrap gap-2">
                {cluster.affectedTests?.map((t, j) => (
                  <span key={j} className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded font-mono">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }

    // ── Step 4: JIRA Tickets ──
    if (stepNum === 4) {
      const data = stepData[4]
      if (!Array.isArray(data)) return <RawFallback tokens={liveTextAccum.current[stepNum] ?? ''} />

      return (
        <div className="space-y-5 fade-slide-in">

          {/* ── Action call-out ── */}
          {!pushResult && (
            <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/40 rounded-2xl px-5 py-4">
              <span className="text-2xl">⚡</span>
              <div className="flex-1">
                <p className="text-amber-400 font-black">Action required — {data.length} ticket{data.length !== 1 ? 's' : ''} ready to push</p>
                <p className="text-slate-400 text-xs mt-0.5">Review and edit tickets below, then connect JIRA to create them with one click</p>
              </div>
            </div>
          )}

          {/* ── JIRA push banner ── */}
          <div className={`rounded-2xl border p-5 ${pushResult ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-blue-500/30 bg-blue-500/5'}`}>

            {pushResult && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">🎉</span>
                  <div>
                    <p className="text-emerald-400 font-black text-lg">{pushResult.created.length} ticket{pushResult.created.length !== 1 ? 's' : ''} created in JIRA</p>
                    {pushResult.failed.length > 0 && <p className="text-yellow-400 text-sm">{pushResult.failed.length} failed</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {pushResult.created.map(t => (
                    <a key={t.key} href={t.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 bg-blue-500/20 border border-blue-500/40 text-blue-400 hover:text-blue-300 px-3 py-1.5 rounded-lg text-sm font-mono font-bold transition-colors">
                      🎯 {t.key} <span className="text-xs opacity-70">↗</span>
                    </a>
                  ))}
                </div>
                {pushResult.failed.length > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <p className="text-yellow-400 text-xs font-bold mb-1">Failed tickets:</p>
                    {pushResult.failed.map((f, i) => <p key={i} className="text-slate-400 text-xs">{f.title} — {f.error}</p>)}
                  </div>
                )}
                <button onClick={() => { setPushResult(null); setPushErr('') }}
                  className="mt-3 text-slate-500 hover:text-slate-300 text-xs underline transition-colors">
                  Push again / use different project
                </button>
              </div>
            )}

            {!pushResult && jiraConnected && !showJiraForm && (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎯</span>
                  <div>
                    <p className="text-white font-bold">Push {data.length} ticket{data.length !== 1 ? 's' : ''} to JIRA</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      Connected to <span className="text-blue-400 font-mono">{jiraCreds.baseUrl}</span>
                      {jiraCreds.projectKey && <> · <span className="text-blue-400 font-mono">{jiraCreds.projectKey}</span></>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {!jiraCreds.projectKey && (
                    <input value={jiraCreds.projectKey} onChange={e => setJiraCreds(p => ({ ...p, projectKey: e.target.value }))}
                      placeholder="Project key e.g. QA"
                      className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-40" />
                  )}
                  <button onClick={() => setShowJiraForm(true)} className="text-slate-500 text-xs underline hover:text-slate-300 transition-colors">Change account</button>
                  <button onClick={() => pushToJira(data, jiraCreds)} disabled={pushing || !jiraCreds.projectKey}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-black px-6 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap">
                    {pushing ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin-slow" /> Creating…</> : '🚀 Push to JIRA'}
                  </button>
                </div>
              </div>
            )}

            {!pushResult && (!jiraConnected || showJiraForm) && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xl">🎯</span>
                  <div>
                    <p className="text-white font-bold">Push tickets directly to JIRA</p>
                    <p className="text-slate-400 text-xs">Connect your JIRA account to create all {data.length} tickets with one click</p>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-3 mb-4">
                  <JiraField label="JIRA Base URL *" value={jiraCreds.baseUrl} onChange={v => setJiraCreds(p => ({ ...p, baseUrl: v }))} placeholder="https://company.atlassian.net" />
                  <JiraField label="Email *" value={jiraCreds.email} onChange={v => setJiraCreds(p => ({ ...p, email: v }))} placeholder="you@company.com" />
                  <JiraField label="API Token *" value={jiraCreds.token} onChange={v => setJiraCreds(p => ({ ...p, token: v }))} placeholder="ATATT3x…" type="password" />
                  <JiraField label="Project Key *" value={jiraCreds.projectKey} onChange={v => setJiraCreds(p => ({ ...p, projectKey: v }))} placeholder="QA" />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {showJiraForm && <button onClick={() => setShowJiraForm(false)} className="text-slate-500 text-xs hover:text-slate-300 underline">Cancel</button>}
                  <p className="text-slate-600 text-xs">Token: <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" className="text-blue-400 hover:underline">id.atlassian.com →</a></p>
                  <button onClick={() => pushToJira(data, jiraCreds)}
                    disabled={pushing || !jiraCreds.baseUrl || !jiraCreds.email || !jiraCreds.token || !jiraCreds.projectKey}
                    className="ml-auto bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-black px-6 py-2.5 rounded-xl transition-colors flex items-center gap-2">
                    {pushing ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin-slow" /> Creating…</> : `🚀 Create ${data.length} tickets in JIRA`}
                  </button>
                </div>
              </div>
            )}

            {pushErr && <p className="mt-3 text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{pushErr}</p>}
          </div>

          {/* ── Ticket cards ── */}
          <p className="text-slate-500 text-xs uppercase tracking-widest">Generated tickets ({data.length}) — click ✏️ to edit before pushing</p>
          {data.map((ticket, i) => {
            const pushed    = pushResult?.created.find(c => c.title === ticket.jiraTitle)
            const isEditing = editingIdx === i
            const draft     = editDrafts[i] ?? ticket
            const files     = attachResults[pushed?.key ?? ''] ?? []

            return (
              <div key={i} className={`bg-slate-900 border rounded-xl transition-all ${pushed ? 'border-emerald-500/40' : isEditing ? 'border-blue-500/40' : 'border-slate-800'}`}>

                {/* Card header */}
                <div className="flex items-start justify-between gap-3 p-5 pb-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {pushed && (
                      <a href={pushed.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 px-2 py-0.5 rounded font-mono font-bold hover:text-emerald-300">
                        {pushed.key} ↗
                      </a>
                    )}
                    {isEditing
                      ? <input value={draft.jiraTitle} onChange={e => setEditDrafts(p => ({ ...p, [i]: { ...draft, jiraTitle: e.target.value } }))}
                          className="bg-slate-800 border border-blue-500/50 rounded-lg px-3 py-1.5 text-white font-bold text-sm focus:outline-none w-full max-w-lg" />
                      : <h3 className="text-white font-bold">{ticket.jiraTitle}</h3>
                    }
                  </div>
                  <div className="flex gap-2 items-center shrink-0">
                    {isEditing ? (
                      <>
                        <select value={draft.severity} onChange={e => setEditDrafts(p => ({ ...p, [i]: { ...draft, severity: e.target.value } }))}
                          className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none">
                          {['critical','high','medium','low'].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <select value={draft.type} onChange={e => setEditDrafts(p => ({ ...p, [i]: { ...draft, type: e.target.value } }))}
                          className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none">
                          {['Bug','Story','Task','Improvement'].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </>
                    ) : (
                      <>
                        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">{ticket.type}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded border ${SEV[ticket.severity] ?? SEV.medium}`}>{ticket.severity}</span>
                      </>
                    )}
                    {!pushed && (
                      isEditing
                        ? <>
                            <button onClick={() => saveTicketEdit(i)} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-lg transition-colors">Save</button>
                            <button onClick={() => setEditingIdx(null)} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
                          </>
                        : <button onClick={() => startEdit(i, ticket)} className="text-xs text-slate-500 hover:text-blue-400 transition-colors px-2 py-1 rounded hover:bg-blue-500/10">✏️ Edit</button>
                    )}
                  </div>
                </div>

                {/* Card body */}
                <div className="grid md:grid-cols-2 gap-4 px-5 pb-4">
                  <div>
                    <p className="text-slate-500 text-xs mb-2 uppercase tracking-widest">Steps to Reproduce</p>
                    {isEditing ? (
                      <div className="space-y-1">
                        {draft.stepsToReproduce?.map((step, j) => (
                          <div key={j} className="flex gap-2 items-start">
                            <span className="text-slate-600 text-sm shrink-0 mt-2">{j + 1}.</span>
                            <input value={step} onChange={e => {
                              const steps = [...draft.stepsToReproduce]
                              steps[j] = e.target.value
                              setEditDrafts(p => ({ ...p, [i]: { ...draft, stepsToReproduce: steps } }))
                            }} className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500" />
                          </div>
                        ))}
                        <button onClick={() => setEditDrafts(p => ({ ...p, [i]: { ...draft, stepsToReproduce: [...draft.stepsToReproduce, ''] } }))}
                          className="text-xs text-slate-600 hover:text-slate-400 mt-1">+ Add step</button>
                      </div>
                    ) : (
                      <ol className="space-y-1">
                        {ticket.stepsToReproduce?.map((step, j) => (
                          <li key={j} className="text-slate-300 text-sm flex gap-2">
                            <span className="text-slate-600 shrink-0">{j + 1}.</span>{step}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <div className="space-y-3">
                    <EditableField label="Expected" value={isEditing ? draft.expectedBehaviour : ticket.expectedBehaviour} color="text-emerald-400"
                      editing={isEditing} onChange={v => setEditDrafts(p => ({ ...p, [i]: { ...draft, expectedBehaviour: v } }))} />
                    <EditableField label="Actual" value={isEditing ? draft.actualBehaviour : ticket.actualBehaviour} color="text-red-400"
                      editing={isEditing} onChange={v => setEditDrafts(p => ({ ...p, [i]: { ...draft, actualBehaviour: v } }))} />
                    <EditableField label="Suggested Fix" value={isEditing ? draft.suggestedFix : ticket.suggestedFix} color="text-slate-300"
                      editing={isEditing} onChange={v => setEditDrafts(p => ({ ...p, [i]: { ...draft, suggestedFix: v } }))} />
                  </div>
                </div>

                {/* Labels + attachment row */}
                <div className="px-5 pb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex flex-wrap gap-2">
                    {ticket.labels?.map((l, j) => <span key={j} className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full">{l}</span>)}
                  </div>

                  {/* Attachment controls — only after JIRA push */}
                  {pushed && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {files.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {files.map((f, j) => (
                            <span key={j} className="text-xs bg-slate-800 border border-slate-700 text-slate-400 px-2 py-1 rounded flex items-center gap-1">
                              📎 {f}
                            </span>
                          ))}
                        </div>
                      )}
                      {attachErr[pushed.key] && <span className="text-xs text-red-400">{attachErr[pushed.key]}</span>}
                      {attachingKey === pushed.key ? (
                        <div className="flex items-center gap-2">
                          <input ref={attachFileRef} type="file" className="hidden" onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) attachToJira(pushed.key, file)
                            e.target.value = ''
                          }} />
                          <button onClick={() => attachFileRef.current?.click()} disabled={attachUploading}
                            className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                            {attachUploading ? <><span className="inline-block w-3 h-3 border border-white/30 border-t-white rounded-full spin-slow" /> Uploading…</> : '📂 Choose file'}
                          </button>
                          <button onClick={() => setAttachingKey(null)} className="text-xs text-slate-600 hover:text-slate-400">✕</button>
                        </div>
                      ) : (
                        <button onClick={() => setAttachingKey(pushed.key)}
                          className="text-xs text-slate-500 hover:text-blue-400 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors flex items-center gap-1">
                          📎 Attach file
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )
    }

    // ── Step 5: Self-Review ──
    if (stepNum === 5) {
      const data = stepData[5] as SelfReview | undefined
      if (!data || typeof data !== 'object' || Array.isArray(data)) return <RawFallback tokens={liveTextAccum.current[stepNum] ?? ''} />
      return (
        <div className="space-y-4 fade-slide-in">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold ${
            data.verdict === 'complete' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
          }`}>{data.verdict === 'complete' ? '✅' : '⚠️'} {data.verdict?.toUpperCase()}</div>
          <p className="text-slate-300">{data.verdictNote}</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[['Total', data.totalFailures],['Classified', data.classified],['Real Bugs', data.realBugs],['Flaky', data.flaky],['Env', data.envIssues],['Clusters', data.clustersCreated]].map(([l, v]) => (
              <div key={l as string} className="bg-slate-800 rounded-lg p-3 text-center">
                <p className="text-white font-black text-xl">{v}</p>
                <p className="text-slate-500 text-xs">{l}</p>
              </div>
            ))}
          </div>
          {data.missedFailures?.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-yellow-400 font-bold text-sm mb-2">⚠️ Potentially Missed</p>
              {data.missedFailures.map((f, i) => <p key={i} className="text-slate-300 text-sm">{f}</p>)}
            </div>
          )}
          {data.consistencyIssues?.length > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
              <p className="text-orange-400 font-bold text-sm mb-2">🔎 Consistency Issues</p>
              {data.consistencyIssues.map((f, i) => <p key={i} className="text-slate-300 text-sm">{f}</p>)}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  function RawFallback({ tokens }: { tokens: string }) {
    return (
      <div className="bg-slate-800 rounded-xl p-4 max-h-64 overflow-y-auto">
        <p className="text-slate-500 text-xs mb-2">Raw output (could not parse structured data)</p>
        <pre className="text-slate-300 text-xs font-mono whitespace-pre-wrap">{tokens}</pre>
      </div>
    )
  }

  function JiraField({ label, value, onChange, placeholder, type = 'text' }: {
    label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string
  }) {
    return (
      <div>
        <label className="text-slate-400 text-xs mb-1 block">{label}</label>
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors" />
      </div>
    )
  }

  function EditableField({ label, value, color, editing, onChange }: {
    label: string; value: string; color: string; editing: boolean; onChange: (v: string) => void
  }) {
    return (
      <div>
        <p className="text-slate-500 text-xs mb-1">{label}</p>
        {editing
          ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500 resize-none" />
          : <p className={`text-sm ${color}`}>{value}</p>
        }
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 font-black text-sm">QA</div>
          <span className="font-black">QA Autopilot</span>
          <span className="text-slate-500 text-sm">/ FailSight / Analysis</span>
        </div>
        <button onClick={() => router.push('/')} className="text-slate-500 hover:text-slate-300 text-xs">← New Analysis</button>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">

        {s5 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 fade-slide-in">
            {[
              { label: 'Total Failures', value: s5.totalFailures, color: 'text-slate-300' },
              { label: 'Real Bugs',      value: s5.realBugs,      color: 'text-red-400' },
              { label: 'Flaky Tests',    value: s5.flaky,         color: 'text-yellow-400' },
              { label: 'JIRA Tickets',   value: s5.ticketsGenerated, color: 'text-emerald-400' },
            ].map(stat => (
              <div key={stat.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
                <p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p>
                <p className="text-slate-500 text-xs mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400">{error}</div>}

        <div className="grid md:grid-cols-[260px_1fr] gap-5">

          {/* Left: step tracker */}
          <div className="space-y-2">
            {LOOP_STEPS.map(step => {
              const isComplete = completedSteps.includes(step.id)
              const isActive   = activeStep === step.id
              const isSelected = displayTab === step.id
              const needsAction = step.id === 4 && step4NeedsAction

              return (
                <button
                  key={step.id}
                  onClick={() => setPinnedTab(step.id)}
                  className={`w-full text-left rounded-xl border p-4 transition-all ${
                    isSelected   ? 'border-rose-500/60 bg-rose-500/10 shadow-lg shadow-rose-500/10' :
                    needsAction  ? 'border-amber-500/50 bg-amber-500/5 hover:border-amber-500/70 cursor-pointer' :
                    isComplete   ? 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50 cursor-pointer' :
                    isActive     ? 'border-rose-500/40 bg-rose-500/5 pulse-ring cursor-default' :
                                   'border-slate-800 bg-slate-900/50 opacity-40 cursor-default'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-1">
                    <span className={`text-xl ${isActive && !isComplete ? 'spin-slow inline-block' : ''}`}>{step.icon}</span>
                    <span className="text-sm font-bold text-white">{step.label}</span>
                    <span className="ml-auto text-xs">
                      {needsAction && !isSelected
                        ? <span className="text-amber-400 font-bold blink">⚡ Action</span>
                        : isComplete
                          ? <span className="text-emerald-400">✓ Done</span>
                          : isActive
                            ? <span className="text-rose-400 blink">● Live</span>
                            : <span className="text-slate-700">Pending</span>
                      }
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs leading-tight">{step.description}</p>
                  {needsAction && !isSelected && (
                    <p className="text-amber-600 text-xs mt-2">Click to review & push to JIRA →</p>
                  )}
                  {isComplete && !needsAction && !isSelected && (
                    <p className="text-emerald-600 text-xs mt-2">Click to view results →</p>
                  )}
                </button>
              )
            })}

            {done && (
              <div className="mt-4 space-y-2">
                <button onClick={copyTickets} className="w-full text-sm bg-slate-800 border border-slate-700 text-slate-300 hover:text-white py-2.5 rounded-xl transition-colors">
                  {copied ? '✓ Copied!' : '📋 Copy JIRA Tickets'}
                </button>
                <button onClick={exportMarkdown} className="w-full text-sm bg-rose-500/20 border border-rose-500/40 text-rose-400 hover:text-rose-300 py-2.5 rounded-xl transition-colors">
                  ↓ Export Markdown
                </button>
              </div>
            )}
          </div>

          {/* Right: content panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 min-h-80">
            {displayTab === 0 ? (
              <div className="text-center py-16">
                <div className="inline-block w-10 h-10 border-4 border-rose-500/30 border-t-rose-500 rounded-full spin-slow mb-4" />
                <p className="text-slate-400">Initialising loop...</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-800">
                  <span className="text-xl">{LOOP_STEPS[displayTab - 1]?.icon}</span>
                  <div>
                    <h2 className="font-bold text-white">Step {displayTab} — {LOOP_STEPS[displayTab - 1]?.label}</h2>
                    <p className="text-slate-500 text-xs">{LOOP_STEPS[displayTab - 1]?.description}</p>
                  </div>
                  {displayTab === 4 && step4NeedsAction && (
                    <span className="ml-auto text-amber-400 text-sm font-bold blink">⚡ Action Needed</span>
                  )}
                  {completedSteps.includes(displayTab) && displayTab !== 4 && <span className="ml-auto text-emerald-400 text-sm font-bold">✓ Complete</span>}
                  {displayTab === 4 && completedSteps.includes(4) && !step4NeedsAction && <span className="ml-auto text-emerald-400 text-sm font-bold">✓ Pushed</span>}
                  {activeStep === displayTab && !completedSteps.includes(displayTab) && <span className="ml-auto text-rose-400 text-sm font-bold blink">● Running</span>}
                </div>
                <StepContent stepNum={displayTab} />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
