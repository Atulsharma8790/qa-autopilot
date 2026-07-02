'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LOOP_STEPS } from '@/lib/prompts'

type Classification = { testName: string; classification: string; confidence: string; reason: string }
type RootCause      = { testName: string; hypothesis: string; evidence: string; affectedArea: string }
type Cluster        = { clusterId: string; clusterTitle: string; rootCause: string; affectedTests: string[]; severity: string }
type JiraTicket     = { clusterId: string; jiraTitle: string; type: string; severity: string; stepsToReproduce: string[]; expectedBehaviour: string; actualBehaviour: string; affectedTests: string[]; suggestedFix: string; labels: string[] }
type SelfReview     = { totalFailures: number; classified: number; realBugs: number; flaky: number; envIssues: number; infraIssues: number; clustersCreated: number; ticketsGenerated: number; missedFailures: string[]; consistencyIssues: string[]; verdict: string; verdictNote: string }

type Steps = {
  step1?: Classification[]
  step2?: RootCause[]
  step3?: Cluster[]
  step4?: JiraTicket[]
  step5?: SelfReview
}

const SEV_COLOR: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

const CLASS_COLOR: Record<string, string> = {
  'real-bug':   'bg-red-500/20 text-red-400',
  'flaky':      'bg-yellow-500/20 text-yellow-400',
  'env-issue':  'bg-orange-500/20 text-orange-400',
  'infra':      'bg-purple-500/20 text-purple-400',
}

export default function AnalyzePage() {
  const router = useRouter()
  const [activeStep, setActiveStep]     = useState(0)
  const [completedSteps, setCompleted]  = useState<number[]>([])
  const [steps, setSteps]               = useState<Steps>({})
  const [done, setDone]                 = useState(false)
  const [error, setError]               = useState('')
  const [activeTab, setActiveTab]       = useState(1)
  const [copied, setCopied]             = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const failures = sessionStorage.getItem('qa_failures')
    if (!failures) { router.push('/'); return }
    runLoop(failures)
    return () => abortRef.current?.abort()
  }, [])

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
              if (data.step > 1) setCompleted(p => [...p, data.step - 1])
            }
            if (data.type === 'complete') {
              setSteps(data.steps)
              setCompleted([1, 2, 3, 4, 5])
              setActiveStep(0)
              setDone(true)
            }
            if (data.type === 'error') setError(data.message)
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    }
  }

  function exportMarkdown() {
    const s = steps
    let md = `# QA Autopilot — Triage Report\n\n`
    if (s.step5) {
      md += `## Summary\n- Total: ${s.step5.totalFailures} | Real Bugs: ${s.step5.realBugs} | Flaky: ${s.step5.flaky} | Env: ${s.step5.envIssues}\n- Clusters: ${s.step5.clustersCreated} | JIRA Tickets: ${s.step5.ticketsGenerated}\n\n`
    }
    if (s.step4) {
      md += `## JIRA Tickets\n`
      s.step4.forEach(t => {
        md += `\n### [${t.severity.toUpperCase()}] ${t.jiraTitle}\n`
        md += `**Severity:** ${t.severity} | **Type:** ${t.type}\n\n`
        md += `**Steps to Reproduce:**\n${t.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`
        md += `**Expected:** ${t.expectedBehaviour}\n**Actual:** ${t.actualBehaviour}\n\n`
        md += `**Suggested Fix:** ${t.suggestedFix}\n`
        md += `**Affected Tests:** ${t.affectedTests.join(', ')}\n`
      })
    }
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'triage-report.md'; a.click()
    URL.revokeObjectURL(url)
  }

  function copyTickets() {
    if (!steps.step4) return
    const text = steps.step4.map(t =>
      `[${t.severity.toUpperCase()}] ${t.jiraTitle}\n${t.stepsToReproduce.join('\n')}`
    ).join('\n\n---\n\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const summary = steps.step5

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 font-black text-sm">QA</div>
          <span className="font-black">QA Autopilot</span>
          <span className="text-slate-500 text-sm">/ FailSight</span>
          <span className="text-slate-600 text-sm">/ Analysis</span>
        </div>
        <button onClick={() => router.push('/')} className="text-slate-500 hover:text-slate-300 text-xs transition-colors">← New Analysis</button>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">

        {/* Loop step tracker */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-white">Agentic Loop Progress</h2>
            {done && <span className="text-emerald-400 text-sm font-bold">✓ Loop Complete</span>}
          </div>
          <div className="grid grid-cols-5 gap-3">
            {LOOP_STEPS.map(step => {
              const isComplete = completedSteps.includes(step.id)
              const isActive   = activeStep === step.id
              return (
                <div
                  key={step.id}
                  className={`rounded-xl border p-3 transition-all cursor-pointer ${
                    isComplete ? 'border-emerald-500/40 bg-emerald-500/10' :
                    isActive   ? 'border-rose-500/50 bg-rose-500/10 pulse-ring' :
                                 'border-slate-700 bg-slate-800/50 opacity-40'
                  }`}
                  onClick={() => isComplete && setActiveTab(step.id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-lg ${isActive ? 'spin-slow inline-block' : ''}`}>{step.icon}</span>
                    {isComplete && <span className="text-emerald-400 text-xs">✓</span>}
                    {isActive   && <span className="text-rose-400 text-xs blink">●</span>}
                  </div>
                  <p className="text-xs font-medium text-slate-300 leading-tight">{step.label}</p>
                  {isActive && <p className="text-rose-400 text-xs mt-1">Running...</p>}
                </div>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 text-red-400">{error}</div>
        )}

        {/* Summary bar */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 fade-slide-in">
            {[
              { label: 'Total Failures', value: summary.totalFailures, color: 'text-slate-300' },
              { label: 'Real Bugs',      value: summary.realBugs,      color: 'text-red-400' },
              { label: 'Flaky Tests',    value: summary.flaky,         color: 'text-yellow-400' },
              { label: 'JIRA Tickets',   value: summary.ticketsGenerated, color: 'text-emerald-400' },
            ].map(stat => (
              <div key={stat.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
                <p className={`text-3xl font-black ${stat.color}`}>{stat.value}</p>
                <p className="text-slate-500 text-xs mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Results tabs */}
        {done && (
          <div className="fade-slide-in">
            {/* Tab bar */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {LOOP_STEPS.map(step => (
                <button
                  key={step.id}
                  onClick={() => setActiveTab(step.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === step.id
                      ? 'bg-rose-500/20 border border-rose-500/40 text-rose-400'
                      : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {step.icon} {step.label}
                </button>
              ))}
              <div className="ml-auto flex gap-2">
                <button onClick={copyTickets} className="px-4 py-2 rounded-lg text-sm bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-colors">
                  {copied ? '✓ Copied' : '📋 Copy Tickets'}
                </button>
                <button onClick={exportMarkdown} className="px-4 py-2 rounded-lg text-sm bg-rose-500/20 border border-rose-500/40 text-rose-400 hover:text-rose-300 transition-colors">
                  ↓ Export MD
                </button>
              </div>
            </div>

            {/* Step 1 — Classifications */}
            {activeTab === 1 && Array.isArray(steps.step1) && (
              <div className="space-y-2">
                {steps.step1.map((item, i) => (
                  <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-4">
                    <span className={`text-xs font-bold px-2 py-1 rounded-lg shrink-0 ${CLASS_COLOR[item.classification] ?? 'bg-slate-700 text-slate-300'}`}>
                      {item.classification}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-200 text-sm font-mono truncate">{item.testName}</p>
                      <p className="text-slate-400 text-xs mt-1">{item.reason}</p>
                    </div>
                    <span className="text-xs text-slate-600 shrink-0">{item.confidence}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Step 2 — Root Causes */}
            {activeTab === 2 && Array.isArray(steps.step2) && (
              <div className="space-y-3">
                {steps.step2.map((item, i) => (
                  <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                    <p className="text-slate-400 text-xs font-mono mb-2">{item.testName}</p>
                    <p className="text-white font-semibold mb-2">{item.hypothesis}</p>
                    <div className="grid md:grid-cols-2 gap-3 mt-3">
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
            )}

            {/* Step 3 — Clusters */}
            {activeTab === 3 && Array.isArray(steps.step3) && (
              <div className="space-y-3">
                {steps.step3.map((cluster, i) => (
                  <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <span className="text-rose-400 text-xs font-mono mr-2">{cluster.clusterId}</span>
                        <span className="text-white font-bold">{cluster.clusterTitle}</span>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg border ${SEV_COLOR[cluster.severity] ?? SEV_COLOR.medium}`}>
                        {cluster.severity}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm mb-3">{cluster.rootCause}</p>
                    <div className="flex flex-wrap gap-2">
                      {cluster.affectedTests.map((t, j) => (
                        <span key={j} className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded font-mono">{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Step 4 — JIRA Tickets */}
            {activeTab === 4 && Array.isArray(steps.step4) && (
              <div className="space-y-4">
                {steps.step4.map((ticket, i) => (
                  <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <h3 className="text-white font-bold text-lg">{ticket.jiraTitle}</h3>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">{ticket.type}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded border ${SEV_COLOR[ticket.severity] ?? SEV_COLOR.medium}`}>{ticket.severity}</span>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-slate-500 text-xs mb-2 uppercase tracking-widest">Steps to Reproduce</p>
                        <ol className="space-y-1">
                          {ticket.stepsToReproduce.map((step, j) => (
                            <li key={j} className="text-slate-300 text-sm flex gap-2">
                              <span className="text-slate-600 shrink-0">{j + 1}.</span>{step}
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-slate-500 text-xs mb-1">Expected</p>
                          <p className="text-emerald-400 text-sm">{ticket.expectedBehaviour}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs mb-1">Actual</p>
                          <p className="text-red-400 text-sm">{ticket.actualBehaviour}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs mb-1">Suggested Fix</p>
                          <p className="text-slate-300 text-sm">{ticket.suggestedFix}</p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {ticket.labels.map((l, j) => (
                        <span key={j} className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-full">{l}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Step 5 — Self Review */}
            {activeTab === 5 && steps.step5 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 fade-slide-in">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold ${
                  steps.step5.verdict === 'complete'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                }`}>
                  {steps.step5.verdict === 'complete' ? '✅' : '⚠️'} {steps.step5.verdict.toUpperCase()}
                </div>
                <p className="text-slate-300">{steps.step5.verdictNote}</p>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {[
                    ['Total', steps.step5.totalFailures],
                    ['Classified', steps.step5.classified],
                    ['Real Bugs', steps.step5.realBugs],
                    ['Flaky', steps.step5.flaky],
                    ['Env Issues', steps.step5.envIssues],
                    ['Clusters', steps.step5.clustersCreated],
                  ].map(([label, val]) => (
                    <div key={label as string} className="bg-slate-800 rounded-lg p-3 text-center">
                      <p className="text-white font-black text-xl">{val}</p>
                      <p className="text-slate-500 text-xs">{label}</p>
                    </div>
                  ))}
                </div>
                {steps.step5.missedFailures.length > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                    <p className="text-yellow-400 font-bold text-sm mb-2">⚠️ Potentially Missed</p>
                    {steps.step5.missedFailures.map((f, i) => <p key={i} className="text-slate-300 text-sm">{f}</p>)}
                  </div>
                )}
                {steps.step5.consistencyIssues.length > 0 && (
                  <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
                    <p className="text-orange-400 font-bold text-sm mb-2">🔎 Consistency Issues</p>
                    {steps.step5.consistencyIssues.map((f, i) => <p key={i} className="text-slate-300 text-sm">{f}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {!done && !error && (
          <div className="text-center py-16">
            <div className="inline-block w-12 h-12 border-4 border-rose-500/30 border-t-rose-500 rounded-full spin-slow mb-4" />
            <p className="text-slate-400">
              {activeStep > 0 ? `Running Step ${activeStep}: ${LOOP_STEPS[activeStep - 1]?.label}...` : 'Initialising loop...'}
            </p>
            <p className="text-slate-600 text-sm mt-2">Watch the steps above light up as the agent works</p>
          </div>
        )}
      </main>
    </div>
  )
}
