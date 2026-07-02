'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LOOP_STEPS } from '@/lib/prompts'

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
  const [liveTokens, setLiveTokens]    = useState<Record<number, string>>({})
  const [done, setDone]                = useState(false)
  const [error, setError]              = useState('')
  const [activeTab, setActiveTab]      = useState(0)  // 0 = follow active step
  const [copied, setCopied]            = useState(false)
  const liveRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const failures = sessionStorage.getItem('qa_failures')
    if (!failures) { router.push('/'); return }
    runLoop(failures)
    return () => abortRef.current?.abort()
  }, [])

  // Auto-scroll live output
  useEffect(() => {
    if (liveRef.current) liveRef.current.scrollTop = liveRef.current.scrollHeight
  }, [liveTokens])

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

        const lines = dec.decode(value).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'step_start') {
              setActiveStep(data.step)
              // Auto-follow: switch tab to the new active step
              setActiveTab(data.step)
            }

            if (data.type === 'token') {
              const s = data.step ?? 0
              setLiveTokens(prev => ({ ...prev, [s]: (prev[s] ?? '') + data.text }))
            }

            if (data.type === 'step_result') {
              const s = data.step as 1 | 2 | 3 | 4 | 5
              setStepData(prev => ({ ...prev, [s]: data.data }))
              setCompleted(prev => prev.includes(s) ? prev : [...prev, s])
            }

            if (data.type === 'complete') {
              setDone(true)
              setActiveStep(0)
              setActiveTab(prev => prev === 0 ? 5 : prev)
            }

            if (data.type === 'error') setError(data.message)
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    }
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
  const displayTab = activeTab === 0 ? activeStep : activeTab

  // ── STEP CONTENT RENDERER ─────────────────────────────────────────────────
  function StepContent({ stepNum }: { stepNum: number }) {
    const isComplete = completedSteps.includes(stepNum)
    const isActive   = activeStep === stepNum
    const tokens     = liveTokens[stepNum] ?? ''

    // Skeleton while waiting
    if (!isComplete && !isActive) {
      return (
        <div className="text-center py-16 text-slate-600">
          <p className="text-4xl mb-3">⏳</p>
          <p>Waiting for loop to reach this step...</p>
        </div>
      )
    }

    // Live stream while active
    if (isActive && !isComplete) {
      return (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-block w-3 h-3 rounded-full bg-rose-500 blink" />
            <span className="text-rose-400 font-bold text-sm">Agent is working on this step...</span>
          </div>
          <div ref={liveRef} className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-64 overflow-y-auto font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
            {tokens || <span className="text-slate-600">Starting...</span>}
            <span className="inline-block w-2 h-4 bg-rose-500 blink ml-0.5 align-text-bottom" />
          </div>
          <p className="text-slate-600 text-xs mt-2">Live output from Claude — structured results appear when this step completes</p>
        </div>
      )
    }

    // Show parsed results once complete
    if (stepNum === 1) {
      const data = stepData[1]
      if (!Array.isArray(data)) return <RawFallback tokens={tokens} />
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

    if (stepNum === 2) {
      const data = stepData[2]
      if (!Array.isArray(data)) return <RawFallback tokens={tokens} />
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

    if (stepNum === 3) {
      const data = stepData[3]
      if (!Array.isArray(data)) return <RawFallback tokens={tokens} />
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

    if (stepNum === 4) {
      const data = stepData[4]
      if (!Array.isArray(data)) return <RawFallback tokens={tokens} />
      return (
        <div className="space-y-4 fade-slide-in">
          {data.map((ticket, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <h3 className="text-white font-bold text-lg">{ticket.jiraTitle}</h3>
                <div className="flex gap-2 shrink-0">
                  <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">{ticket.type}</span>
                  <span className={`text-xs font-bold px-2 py-1 rounded border ${SEV[ticket.severity] ?? SEV.medium}`}>{ticket.severity}</span>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-500 text-xs mb-2 uppercase tracking-widest">Steps to Reproduce</p>
                  <ol className="space-y-1">
                    {ticket.stepsToReproduce?.map((step, j) => (
                      <li key={j} className="text-slate-300 text-sm flex gap-2"><span className="text-slate-600 shrink-0">{j + 1}.</span>{step}</li>
                    ))}
                  </ol>
                </div>
                <div className="space-y-3">
                  <div><p className="text-slate-500 text-xs mb-1">Expected</p><p className="text-emerald-400 text-sm">{ticket.expectedBehaviour}</p></div>
                  <div><p className="text-slate-500 text-xs mb-1">Actual</p><p className="text-red-400 text-sm">{ticket.actualBehaviour}</p></div>
                  <div><p className="text-slate-500 text-xs mb-1">Suggested Fix</p><p className="text-slate-300 text-sm">{ticket.suggestedFix}</p></div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {ticket.labels?.map((l, j) => <span key={j} className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full">{l}</span>)}
              </div>
            </div>
          ))}
        </div>
      )
    }

    if (stepNum === 5) {
      const data = stepData[5] as SelfReview | undefined
      if (!data || typeof data !== 'object' || Array.isArray(data)) return <RawFallback tokens={tokens} />
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

        {/* Summary bar — shown as soon as step 5 is done */}
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

        {/* Step cards + content panel */}
        <div className="grid md:grid-cols-[260px_1fr] gap-5">

          {/* Left: step tracker cards */}
          <div className="space-y-2">
            {LOOP_STEPS.map(step => {
              const isComplete = completedSteps.includes(step.id)
              const isActive   = activeStep === step.id
              const isSelected = displayTab === step.id

              return (
                <button
                  key={step.id}
                  onClick={() => setActiveTab(step.id)}
                  className={`w-full text-left rounded-xl border p-4 transition-all ${
                    isSelected  ? 'border-rose-500/60 bg-rose-500/10 shadow-lg shadow-rose-500/10' :
                    isComplete  ? 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50 cursor-pointer' :
                    isActive    ? 'border-rose-500/40 bg-rose-500/5 pulse-ring cursor-default' :
                                  'border-slate-800 bg-slate-900/50 opacity-40 cursor-default'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-1">
                    <span className={`text-xl ${isActive && !isComplete ? 'spin-slow inline-block' : ''}`}>{step.icon}</span>
                    <span className="text-sm font-bold text-white">{step.label}</span>
                    <span className="ml-auto text-xs">
                      {isComplete ? <span className="text-emerald-400">✓ Done</span> :
                       isActive   ? <span className="text-rose-400 blink">● Live</span> :
                                    <span className="text-slate-700">Pending</span>}
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs leading-tight">{step.description}</p>
                  {isComplete && !isSelected && (
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
                  {completedSteps.includes(displayTab) && <span className="ml-auto text-emerald-400 text-sm font-bold">✓ Complete</span>}
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
