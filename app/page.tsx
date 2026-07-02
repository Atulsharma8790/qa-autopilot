'use client'
import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LOOP_STEPS } from '@/lib/prompts'

const SAMPLE = `FAILED tests/auth/login.spec.ts > should login with valid credentials
Error: Timeout of 5000ms exceeded. At waitForSelector('.dashboard-header')

FAILED tests/checkout/payment.spec.ts > should process credit card payment
Error: AssertionError: expected 500 to equal 200
Response body: {"error":"Payment gateway connection refused"}

FAILED tests/checkout/payment.spec.ts > should apply discount code
Error: AssertionError: expected 500 to equal 200
Response body: {"error":"Payment gateway connection refused"}

FAILED tests/search/product-search.spec.ts > should return results for keyword
Error: AssertionError: expected [] to have length > 0

FAILED tests/auth/logout.spec.ts > should clear session on logout
Error: Timeout — this test has failed 4 of last 7 runs

FAILED tests/profile/update.spec.ts > should update user email
Error: TypeError: Cannot read properties of undefined (reading 'email')`

type EnrichSource = 'github' | 'jira' | 'confluence'

export default function Home() {
  const router = useRouter()
  const [passcode, setPasscode]       = useState('')
  const [authed, setAuthed]           = useState(false)
  const [authErr, setAuthErr]         = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  // Primary input
  const [inputTab, setInputTab]       = useState<'paste' | 'upload'>('paste')
  const [pastedText, setPastedText]   = useState('')
  const [uploadedText, setUploadedText] = useState('')
  const [uploadedFile, setUploadedFile] = useState('')
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadErr, setUploadErr]     = useState('')
  const [dragging, setDragging]       = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Enrichment sources — multiple can be open/active at once
  const [openEnrich, setOpenEnrich]   = useState<Set<EnrichSource>>(new Set())
  const [enrichContent, setEnrichContent] = useState<Record<EnrichSource, string>>({ github: '', jira: '', confluence: '' })
  const [enrichMeta, setEnrichMeta]   = useState<Record<EnrichSource, string>>({ github: '', jira: '', confluence: '' })
  const [enrichLoading, setEnrichLoading] = useState<Record<EnrichSource, boolean>>({ github: false, jira: false, confluence: false })
  const [enrichErr, setEnrichErr]     = useState<Record<EnrichSource, string>>({ github: '', jira: '', confluence: '' })

  // GitHub fields
  const [ghOwner, setGhOwner]   = useState(''); const [ghRepo, setGhRepo]     = useState('')
  const [ghRunId, setGhRunId]   = useState(''); const [ghBranch, setGhBranch] = useState('main')
  const [ghToken, setGhToken]   = useState('')

  // JIRA fields
  const [jiraUrl, setJiraUrl]     = useState(''); const [jiraEmail, setJiraEmail]   = useState('')
  const [jiraToken, setJiraToken] = useState(''); const [jiraIssues, setJiraIssues] = useState('')
  const [jiraProject, setJiraProject] = useState(''); const [jiraJql, setJiraJql]   = useState('')

  // Confluence fields
  const [confUrl, setConfUrl]     = useState(''); const [confEmail, setConfEmail]   = useState('')
  const [confToken, setConfToken] = useState(''); const [confPageId, setConfPageId] = useState('')
  const [confSpace, setConfSpace] = useState(''); const [confTitle, setConfTitle]   = useState('')

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault(); setAuthLoading(true); setAuthErr('')
    const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) })
    if (res.ok) { sessionStorage.setItem('qa_authed', '1'); setAuthed(true) }
    else setAuthErr('Incorrect passcode. Try again.')
    setAuthLoading(false)
  }

  const handleFile = useCallback(async (file: File) => {
    setUploadErr(''); setUploadLoading(true); setUploadedFile(file.name)
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) setUploadedText(data.content)
    else setUploadErr(data.error ?? 'Upload failed')
    setUploadLoading(false)
  }, [])

  async function fetchEnrich(source: EnrichSource) {
    setEnrichErr(prev => ({ ...prev, [source]: '' }))
    setEnrichLoading(prev => ({ ...prev, [source]: true }))

    let endpoint = ''; let body: Record<string, string> = {}

    if (source === 'github') {
      endpoint = '/api/fetch-github'
      body = { owner: ghOwner, repo: ghRepo, runId: ghRunId, branch: ghBranch, token: ghToken }
    } else if (source === 'jira') {
      endpoint = '/api/fetch-jira'
      body = { baseUrl: jiraUrl, email: jiraEmail, token: jiraToken, issueKeys: jiraIssues, projectKey: jiraProject, jql: jiraJql }
    } else {
      endpoint = '/api/fetch-confluence'
      body = { baseUrl: confUrl, email: confEmail, token: confToken, pageId: confPageId, spaceKey: confSpace, title: confTitle }
    }

    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (res.ok) {
      setEnrichContent(prev => ({ ...prev, [source]: data.content }))
      setEnrichMeta(prev => ({ ...prev, [source]: JSON.stringify(data.meta ?? {}) }))
      // Save JIRA credentials for use in the analyzer's Push-to-JIRA feature
      if (source === 'jira') {
        sessionStorage.setItem('qa_jira', JSON.stringify({ baseUrl: jiraUrl, email: jiraEmail, token: jiraToken, projectKey: jiraProject }))
      }
    } else {
      setEnrichErr(prev => ({ ...prev, [source]: data.error ?? `${source} fetch failed` }))
    }
    setEnrichLoading(prev => ({ ...prev, [source]: false }))
  }

  function toggleEnrich(s: EnrichSource) {
    setOpenEnrich(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }

  // Combine all content
  const primaryText = inputTab === 'paste' ? pastedText : uploadedText
  const enrichedParts = (Object.entries(enrichContent) as [EnrichSource, string][])
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `\n\n# --- Additional context from ${k.toUpperCase()} ---\n${v}`)
  const combined = (primaryText + enrichedParts.join('')).trim()

  const activeEnrichCount = Object.values(enrichContent).filter(v => v.trim()).length

  function handleAnalyze() {
    sessionStorage.setItem('qa_failures', combined)
    router.push('/analyze')
  }

  // ── AUTH GATE ──────────────────────────────────────────────────────────────
  if (!authed) return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 px-4 py-2 rounded-full mb-6">
            <span className="text-rose-400 text-sm font-bold tracking-widest uppercase">QA Autopilot · FailSight</span>
          </div>
          <h1 className="text-3xl font-black mb-2">Access Required</h1>
          <p className="text-slate-400">Enter your passcode to start triaging</p>
        </div>
        <form onSubmit={handleAuth} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <input type="password" placeholder="Access passcode" value={passcode} onChange={e => setPasscode(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors" />
          {authErr && <p className="text-rose-400 text-sm">{authErr}</p>}
          <button type="submit" disabled={authLoading || !passcode}
            className="w-full bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
            {authLoading ? 'Verifying...' : 'Access QA Autopilot →'}
          </button>
        </form>
        <p className="text-center text-slate-600 text-xs mt-4">
          Built by <a href="https://atulsharma8790.github.io" className="text-slate-500 hover:text-slate-300">Atul Sharma</a>
        </p>
      </div>
    </div>
  )

  // ── MAIN APP ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 font-black text-sm">QA</div>
          <span className="font-black">QA Autopilot</span>
          <span className="text-slate-500 text-sm ml-1">/ FailSight</span>
        </div>
        <a href="https://atulsharma8790.github.io" className="text-slate-500 hover:text-slate-300 text-xs">← Portfolio</a>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-black mb-3">
            <span className="text-rose-400">Triage CI failures</span><br/>in 45 seconds
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Add your failure logs — paste text or upload a file — then optionally enrich with data from GitHub, JIRA, or Confluence.
          </p>
        </div>

        {/* Loop preview */}
        <div className="grid grid-cols-5 gap-2 mb-8">
          {LOOP_STEPS.map((step, i) => (
            <div key={step.id} className="relative">
              {i < LOOP_STEPS.length - 1 && <div className="absolute top-6 left-[60%] w-full h-px bg-slate-700 z-0" />}
              <div className="relative z-10 flex flex-col items-center gap-2 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-xl">{step.icon}</div>
                <p className="text-slate-400 text-xs font-medium leading-tight">{step.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── SECTION 1: Primary Input ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden mb-4">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
            <div>
              <h2 className="font-bold text-white">Step 1 — Add your failure log</h2>
              <p className="text-slate-500 text-xs mt-0.5">Paste directly or upload a file. Both work — use whichever is faster.</p>
            </div>
            {primaryText && <span className="text-emerald-400 text-sm font-bold">✓ {primaryText.length.toLocaleString()} chars ready</span>}
          </div>

          {/* Paste / Upload toggle */}
          <div className="flex border-b border-slate-800">
            {([['paste', '📋 Paste text'], ['upload', '📁 Upload file']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setInputTab(id)}
                className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
                  inputTab === id ? 'border-rose-500 text-rose-400' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}>{label}</button>
            ))}
          </div>

          <div className="p-6">
            {inputTab === 'paste' && (
              <div>
                <div className="flex justify-end mb-2">
                  <button onClick={() => setPastedText(SAMPLE)}
                    className="text-xs text-rose-400 hover:text-rose-300 border border-rose-500/30 px-3 py-1 rounded-lg">
                    Load sample
                  </button>
                </div>
                <textarea value={pastedText} onChange={e => setPastedText(e.target.value)}
                  placeholder={`Paste CI failures here — JUnit XML, Allure output, stack traces, copy-paste from CI dashboard...\n\nExample:\nFAILED tests/auth/login.spec.ts > should login\nError: Timeout of 5000ms exceeded`}
                  className="w-full h-52 bg-slate-800 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 placeholder-slate-600 font-mono resize-none focus:outline-none focus:border-rose-500 transition-colors" />
              </div>
            )}

            {inputTab === 'upload' && (
              <div>
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                    dragging ? 'border-rose-500 bg-rose-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
                  }`}>
                  <input ref={fileRef} type="file" accept=".xml,.json,.txt,.csv,.log" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                  {uploadLoading
                    ? <><div className="inline-block w-8 h-8 border-2 border-rose-500/30 border-t-rose-500 rounded-full spin-slow mb-3" /><p className="text-slate-400">Parsing...</p></>
                    : uploadedFile
                    ? <><p className="text-emerald-400 text-2xl mb-1">✓</p><p className="text-emerald-400 font-bold">{uploadedFile}</p><p className="text-slate-500 text-xs mt-1">Click to replace</p></>
                    : <><p className="text-4xl mb-2">📁</p><p className="text-slate-300 font-semibold">Drop file or click to browse</p><p className="text-slate-500 text-xs mt-1">.xml · .json · .txt · .csv · .log</p></>}
                </div>
                {uploadErr && <p className="text-red-400 text-sm mt-2">{uploadErr}</p>}
                {uploadedText && !uploadLoading && (
                  <div className="mt-3 bg-slate-800 rounded-xl p-3 max-h-32 overflow-y-auto">
                    <pre className="text-slate-300 text-xs font-mono whitespace-pre-wrap">{uploadedText.slice(0, 500)}{uploadedText.length > 500 ? '…' : ''}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── SECTION 2: Enrichment sources ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-white">
                Step 2 — Enrich with more context
                <span className="text-slate-500 font-normal ml-2 text-sm">(optional)</span>
              </h2>
              <p className="text-slate-500 text-xs mt-0.5">Pull in related data from GitHub, JIRA, or Confluence. All sources are combined with your failure log automatically.</p>
            </div>
            {activeEnrichCount > 0 && (
              <span className="text-emerald-400 text-sm font-bold bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full">
                +{activeEnrichCount} source{activeEnrichCount > 1 ? 's' : ''} added
              </span>
            )}
          </div>

          <div className="divide-y divide-slate-800">
            {/* GitHub */}
            <EnrichPanel
              id="github" icon="🐙" label="GitHub Actions" desc="Fetch failures from a workflow run"
              open={openEnrich.has('github')} onToggle={() => toggleEnrich('github')}
              loaded={!!enrichContent.github} meta={enrichMeta.github}
              loading={enrichLoading.github} error={enrichErr.github}
            >
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Owner / Org *" value={ghOwner} onChange={setGhOwner} placeholder="atulsharma8790" />
                <Field label="Repository *" value={ghRepo} onChange={setGhRepo} placeholder="my-app" />
                <Field label="Run ID" value={ghRunId} onChange={setGhRunId} placeholder="(blank = latest failed run)" />
                <Field label="Branch" value={ghBranch} onChange={setGhBranch} placeholder="main" />
                <div className="md:col-span-2">
                  <Field label="Personal Access Token (optional for public repos)" value={ghToken} onChange={setGhToken} placeholder="ghp_..." type="password" />
                </div>
              </div>
              <button onClick={() => fetchEnrich('github')} disabled={enrichLoading.github || !ghOwner || !ghRepo}
                className="mt-4 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">
                {enrichLoading.github ? 'Fetching…' : '🐙 Fetch from GitHub'}
              </button>
            </EnrichPanel>

            {/* JIRA */}
            <EnrichPanel
              id="jira" icon="🎯" label="JIRA" desc="Import bugs or test failures from JIRA issues"
              open={openEnrich.has('jira')} onToggle={() => toggleEnrich('jira')}
              loaded={!!enrichContent.jira} meta={enrichMeta.jira}
              loading={enrichLoading.jira} error={enrichErr.jira}
            >
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="JIRA Base URL *" value={jiraUrl} onChange={setJiraUrl} placeholder="https://company.atlassian.net" />
                <Field label="Email *" value={jiraEmail} onChange={setJiraEmail} placeholder="you@company.com" />
                <div className="md:col-span-2">
                  <Field label="API Token *" value={jiraToken} onChange={setJiraToken} placeholder="ATATT3x…" type="password" />
                </div>
                <Field label="Issue Keys (comma-separated)" value={jiraIssues} onChange={setJiraIssues} placeholder="QA-123, BUG-45" />
                <Field label="Project Key (all open bugs)" value={jiraProject} onChange={setJiraProject} placeholder="QA" />
                <div className="md:col-span-2">
                  <Field label="Custom JQL (overrides project key)" value={jiraJql} onChange={setJiraJql} placeholder={`project = QA AND sprint in openSprints()`} />
                </div>
              </div>
              <button onClick={() => fetchEnrich('jira')} disabled={enrichLoading.jira || !jiraUrl || !jiraEmail || !jiraToken}
                className="mt-4 bg-blue-600/80 hover:bg-blue-600 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">
                {enrichLoading.jira ? 'Fetching…' : '🎯 Fetch from JIRA'}
              </button>
            </EnrichPanel>

            {/* Confluence */}
            <EnrichPanel
              id="confluence" icon="📘" label="Confluence" desc="Read a test report or QA summary page"
              open={openEnrich.has('confluence')} onToggle={() => toggleEnrich('confluence')}
              loaded={!!enrichContent.confluence} meta={enrichMeta.confluence}
              loading={enrichLoading.confluence} error={enrichErr.confluence}
            >
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Confluence URL *" value={confUrl} onChange={setConfUrl} placeholder="https://company.atlassian.net/wiki" />
                <Field label="Email *" value={confEmail} onChange={setConfEmail} placeholder="you@company.com" />
                <div className="md:col-span-2">
                  <Field label="API Token *" value={confToken} onChange={setConfToken} placeholder="ATATT3x…" type="password" />
                </div>
                <Field label="Page ID" value={confPageId} onChange={setConfPageId} placeholder="123456789" />
                <Field label="Space Key" value={confSpace} onChange={setConfSpace} placeholder="QA" />
                <div className="md:col-span-2">
                  <Field label="Page Title (search by space + title)" value={confTitle} onChange={setConfTitle} placeholder="Sprint 23 Test Report" />
                </div>
              </div>
              <button onClick={() => fetchEnrich('confluence')} disabled={enrichLoading.confluence || !confUrl || !confEmail || !confToken}
                className="mt-4 bg-blue-700/80 hover:bg-blue-700 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">
                {enrichLoading.confluence ? 'Fetching…' : '📘 Fetch from Confluence'}
              </button>
            </EnrichPanel>
          </div>
        </div>

        {/* ── LAUNCH ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-white font-bold">
              {combined ? `${combined.length.toLocaleString()} chars ready to triage` : 'No content yet — paste or upload above'}
            </p>
            <p className="text-slate-500 text-xs mt-0.5">
              {[
                primaryText && (inputTab === 'paste' ? 'pasted text' : `file: ${uploadedFile}`),
                enrichContent.github && '+ GitHub',
                enrichContent.jira   && '+ JIRA',
                enrichContent.confluence && '+ Confluence',
              ].filter(Boolean).join(' · ') || 'Add content to begin'}
            </p>
          </div>
          <button onClick={handleAnalyze} disabled={!combined}
            className="bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black px-8 py-3 rounded-xl transition-colors whitespace-nowrap">
            🚀 Start Triage Loop
          </button>
        </div>
      </main>
    </div>
  )
}

// ── Reusable components ────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string
}) {
  return (
    <div>
      <label className="text-slate-400 text-xs mb-1 block">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
    </div>
  )
}

function EnrichPanel({ id, icon, label, desc, open, onToggle, loaded, meta, loading, error, children }: {
  id: string; icon: string; label: string; desc: string
  open: boolean; onToggle: () => void
  loaded: boolean; meta: string; loading: boolean; error: string
  children: React.ReactNode
}) {
  return (
    <div className={`transition-colors ${loaded ? 'bg-emerald-500/5' : ''}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-800/50 transition-colors text-left">
        <span className="text-xl">{icon}</span>
        <div className="flex-1">
          <span className="font-semibold text-white text-sm">{label}</span>
          <span className="text-slate-500 text-xs ml-2">{desc}</span>
        </div>
        <div className="flex items-center gap-3">
          {loading && <span className="inline-block w-4 h-4 border-2 border-rose-500/30 border-t-rose-500 rounded-full spin-slow" />}
          {loaded && !loading && <span className="text-emerald-400 text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">✓ Added</span>}
          {error && <span className="text-red-400 text-xs">⚠ Error</span>}
          <span className={`text-slate-500 text-lg transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
        </div>
      </button>

      {open && (
        <div className="px-6 pb-6 fade-slide-in">
          {children}
          {error && <p className="mt-3 text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
          {loaded && meta && (
            <p className="mt-3 text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">✓ {meta}</p>
          )}
        </div>
      )}
    </div>
  )
}
