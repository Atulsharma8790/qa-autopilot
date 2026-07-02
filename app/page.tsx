'use client'
import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LOOP_STEPS } from '@/lib/prompts'

const SAMPLE = `FAILED tests/auth/login.spec.ts > should login with valid credentials
Error: Timeout of 5000ms exceeded. At waitForSelector('.dashboard-header')
Stack: at Context.<anonymous> (tests/auth/login.spec.ts:24:5)

FAILED tests/checkout/payment.spec.ts > should process credit card payment
Error: AssertionError: expected 500 to equal 200
Response body: {"error":"Payment gateway connection refused"}

FAILED tests/checkout/payment.spec.ts > should apply discount code
Error: AssertionError: expected 500 to equal 200
Response body: {"error":"Payment gateway connection refused"}

FAILED tests/search/product-search.spec.ts > should return results for keyword
Error: AssertionError: expected [] to have length > 0
Actual response: {"results":[],"total":0}

FAILED tests/auth/logout.spec.ts > should clear session on logout
Error: Timeout of 5000ms exceeded — this test has failed 4 of last 7 runs

FAILED tests/profile/update.spec.ts > should update user email
Error: TypeError: Cannot read properties of undefined (reading 'email')
at ProfilePage.saveChanges (app/profile/page.ts:87:22)`

type InputMode = 'paste' | 'upload' | 'github' | 'jira' | 'confluence'

const INPUT_MODES: { id: InputMode; icon: string; label: string; desc: string }[] = [
  { id: 'paste',      icon: '📋', label: 'Paste',      desc: 'Paste failure text, stack traces, or XML directly' },
  { id: 'upload',     icon: '📁', label: 'Upload File', desc: 'JUnit XML, Allure JSON/XML, log files, .txt, .csv' },
  { id: 'github',     icon: '🐙', label: 'GitHub Actions', desc: 'Fetch failures from a GitHub Actions run' },
  { id: 'jira',       icon: '🎯', label: 'JIRA',        desc: 'Import bugs/failures from JIRA issues or project' },
  { id: 'confluence', icon: '📘', label: 'Confluence',  desc: 'Read test report from a Confluence page' },
]

export default function Home() {
  const router = useRouter()
  const [passcode, setPasscode]     = useState('')
  const [authed, setAuthed]         = useState(false)
  const [authErr, setAuthErr]       = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [mode, setMode]             = useState<InputMode>('paste')
  const [failures, setFailures]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [loadErr, setLoadErr]       = useState('')
  const [loadMeta, setLoadMeta]     = useState<Record<string, unknown> | null>(null)

  // Upload state
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]     = useState(false)
  const [uploadedFile, setUploadedFile] = useState<string>('')

  // GitHub state
  const [ghOwner, setGhOwner]       = useState('')
  const [ghRepo, setGhRepo]         = useState('')
  const [ghRunId, setGhRunId]       = useState('')
  const [ghBranch, setGhBranch]     = useState('main')
  const [ghToken, setGhToken]       = useState('')

  // JIRA state
  const [jiraUrl, setJiraUrl]       = useState('')
  const [jiraEmail, setJiraEmail]   = useState('')
  const [jiraToken, setJiraToken]   = useState('')
  const [jiraIssues, setJiraIssues] = useState('')
  const [jiraProject, setJiraProject] = useState('')
  const [jiraJql, setJiraJql]       = useState('')

  // Confluence state
  const [confUrl, setConfUrl]       = useState('')
  const [confEmail, setConfEmail]   = useState('')
  const [confToken, setConfToken]   = useState('')
  const [confPageId, setConfPageId] = useState('')
  const [confSpace, setConfSpace]   = useState('')
  const [confTitle, setConfTitle]   = useState('')

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true); setAuthErr('')
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    })
    if (res.ok) { sessionStorage.setItem('qa_authed', '1'); setAuthed(true) }
    else setAuthErr('Incorrect passcode. Try again.')
    setAuthLoading(false)
  }

  const handleFileDrop = useCallback(async (file: File) => {
    setLoadErr(''); setLoadMeta(null); setFailures(''); setLoading(true)
    setUploadedFile(file.name)
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) { setFailures(data.content); setLoadMeta({ source: 'file', name: file.name }) }
    else setLoadErr(data.error ?? 'Upload failed')
    setLoading(false)
  }, [])

  async function fetchGithub() {
    if (!ghOwner || !ghRepo) return
    setLoadErr(''); setLoadMeta(null); setLoading(true)
    const res = await fetch('/api/fetch-github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: ghOwner, repo: ghRepo, runId: ghRunId || undefined, branch: ghBranch, token: ghToken || undefined }),
    })
    const data = await res.json()
    if (res.ok) { setFailures(data.content); setLoadMeta(data.meta) }
    else setLoadErr(data.error ?? 'GitHub fetch failed')
    setLoading(false)
  }

  async function fetchJira() {
    if (!jiraUrl || !jiraEmail || !jiraToken) return
    setLoadErr(''); setLoadMeta(null); setLoading(true)
    const res = await fetch('/api/fetch-jira', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: jiraUrl, email: jiraEmail, token: jiraToken, issueKeys: jiraIssues || undefined, projectKey: jiraProject || undefined, jql: jiraJql || undefined }),
    })
    const data = await res.json()
    if (res.ok) { setFailures(data.content); setLoadMeta(data.meta) }
    else setLoadErr(data.error ?? 'JIRA fetch failed')
    setLoading(false)
  }

  async function fetchConfluence() {
    if (!confUrl || !confEmail || !confToken) return
    setLoadErr(''); setLoadMeta(null); setLoading(true)
    const res = await fetch('/api/fetch-confluence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: confUrl, email: confEmail, token: confToken, pageId: confPageId || undefined, spaceKey: confSpace || undefined, title: confTitle || undefined }),
    })
    const data = await res.json()
    if (res.ok) { setFailures(data.content); setLoadMeta(data.meta) }
    else setLoadErr(data.error ?? 'Confluence fetch failed')
    setLoading(false)
  }

  function handleAnalyze() {
    sessionStorage.setItem('qa_failures', failures)
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
          <input type="password" placeholder="Access passcode" value={passcode}
            onChange={e => setPasscode(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors" />
          {authErr && <p className="text-rose-400 text-sm">{authErr}</p>}
          <button type="submit" disabled={authLoading || !passcode}
            className="w-full bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
            {authLoading ? 'Verifying...' : 'Access QA Autopilot →'}
          </button>
        </form>
        <p className="text-center text-slate-600 text-xs mt-4">
          Built by <a href="https://atulsharma8790.github.io" className="text-slate-500 hover:text-slate-300">Atul Sharma</a> · QA Automation Architect
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
          <span className="font-black text-white">QA Autopilot</span>
          <span className="text-slate-500 text-sm ml-1">/ FailSight</span>
        </div>
        <a href="https://atulsharma8790.github.io" className="text-slate-500 hover:text-slate-300 text-xs transition-colors">← Portfolio</a>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-black mb-3">
            <span className="text-rose-400">Triage CI failures</span><br/>in 45 seconds
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Paste failures, upload a report, or connect GitHub / JIRA / Confluence. QA Autopilot runs a 5-step agentic loop and delivers triage, clusters, and JIRA tickets.
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

        {/* Input mode tabs */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="flex border-b border-slate-800 overflow-x-auto">
            {INPUT_MODES.map(m => (
              <button key={m.id} onClick={() => { setMode(m.id); setLoadErr(''); setLoadMeta(null) }}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  mode === m.id
                    ? 'border-rose-500 text-rose-400 bg-rose-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* ── PASTE ── */}
            {mode === 'paste' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-slate-300 font-bold text-sm uppercase tracking-widest">CI Failure Log</label>
                  <div className="flex gap-2 items-center">
                    <span className="text-slate-600 text-xs">{failures.length.toLocaleString()} chars</span>
                    <button onClick={() => setFailures(SAMPLE)}
                      className="text-xs text-rose-400 hover:text-rose-300 border border-rose-500/30 px-3 py-1 rounded-lg transition-colors">
                      Load sample
                    </button>
                  </div>
                </div>
                <textarea value={failures} onChange={e => setFailures(e.target.value)}
                  placeholder={`Paste CI failures here — JUnit XML, Allure output, stack traces, or a mix...\n\nExample:\nFAILED tests/auth/login.spec.ts > should login with valid credentials\nError: Timeout of 5000ms exceeded`}
                  className="w-full h-56 bg-slate-800 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 placeholder-slate-600 font-mono resize-none focus:outline-none focus:border-rose-500 transition-colors" />
              </div>
            )}

            {/* ── UPLOAD ── */}
            {mode === 'upload' && (
              <div>
                <p className="text-slate-400 text-sm mb-4">Upload JUnit XML, Allure JSON/XML, plain log files, .txt, or .csv reports.</p>
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFileDrop(f) }}
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                    dragging ? 'border-rose-500 bg-rose-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'
                  }`}>
                  <input ref={fileRef} type="file" accept=".xml,.json,.txt,.csv,.log" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFileDrop(f) }} />
                  {loading
                    ? <><div className="inline-block w-8 h-8 border-2 border-rose-500/30 border-t-rose-500 rounded-full spin-slow mb-3" /><p className="text-slate-400">Parsing file...</p></>
                    : uploadedFile
                    ? <><p className="text-emerald-400 text-2xl mb-2">✓</p><p className="text-emerald-400 font-bold">{uploadedFile} loaded</p><p className="text-slate-500 text-sm mt-1">Click to upload a different file</p></>
                    : <><p className="text-4xl mb-3">📁</p><p className="text-slate-300 font-semibold">Drop file here or click to browse</p><p className="text-slate-500 text-sm mt-2">.xml · .json · .txt · .csv · .log</p></>
                  }
                </div>
                {failures && !loading && (
                  <div className="mt-4 bg-slate-800 rounded-xl p-4 max-h-40 overflow-y-auto">
                    <p className="text-slate-500 text-xs mb-2 uppercase tracking-widest">Extracted content preview</p>
                    <pre className="text-slate-300 text-xs font-mono whitespace-pre-wrap">{failures.slice(0, 800)}{failures.length > 800 ? '...' : ''}</pre>
                  </div>
                )}
              </div>
            )}

            {/* ── GITHUB ── */}
            {mode === 'github' && (
              <div className="space-y-4">
                <p className="text-slate-400 text-sm">Fetch failure logs directly from a GitHub Actions workflow run. A personal access token is optional for public repos but required for private repos and log content.</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Owner / Organisation *</label>
                    <input value={ghOwner} onChange={e => setGhOwner(e.target.value)} placeholder="e.g. atulsharma8790"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Repository Name *</label>
                    <input value={ghRepo} onChange={e => setGhRepo(e.target.value)} placeholder="e.g. my-app"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Run ID <span className="text-slate-600">(leave blank for latest failed run)</span></label>
                    <input value={ghRunId} onChange={e => setGhRunId(e.target.value)} placeholder="e.g. 12345678"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Branch <span className="text-slate-600">(used when Run ID is blank)</span></label>
                    <input value={ghBranch} onChange={e => setGhBranch(e.target.value)} placeholder="main"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-slate-400 text-xs mb-1 block">Personal Access Token <span className="text-slate-600">(optional for public repos, required for private)</span></label>
                    <input type="password" value={ghToken} onChange={e => setGhToken(e.target.value)} placeholder="ghp_..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                </div>
                <button onClick={fetchGithub} disabled={loading || !ghOwner || !ghRepo}
                  className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-bold px-6 py-2.5 rounded-xl transition-colors text-sm flex items-center gap-2">
                  {loading ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin-slow" /> Fetching...</> : '🐙 Fetch from GitHub'}
                </button>
                {failures && !loading && (
                  <div className="bg-slate-800 rounded-xl p-4 max-h-40 overflow-y-auto">
                    <p className="text-slate-500 text-xs mb-2 uppercase tracking-widest">Fetched content preview</p>
                    <pre className="text-slate-300 text-xs font-mono whitespace-pre-wrap">{failures.slice(0, 600)}{failures.length > 600 ? '...' : ''}</pre>
                  </div>
                )}
              </div>
            )}

            {/* ── JIRA ── */}
            {mode === 'jira' && (
              <div className="space-y-4">
                <p className="text-slate-400 text-sm">Import bugs or failures from JIRA. Use issue keys for specific issues, project key for all open bugs, or write custom JQL.</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">JIRA Base URL *</label>
                    <input value={jiraUrl} onChange={e => setJiraUrl(e.target.value)} placeholder="https://yourcompany.atlassian.net"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Email *</label>
                    <input value={jiraEmail} onChange={e => setJiraEmail(e.target.value)} placeholder="you@company.com"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-slate-400 text-xs mb-1 block">API Token * <span className="text-slate-600">— <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" className="text-blue-400 hover:underline">Generate here</a></span></label>
                    <input type="password" value={jiraToken} onChange={e => setJiraToken(e.target.value)} placeholder="ATATT3x..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Issue Keys <span className="text-slate-600">(comma-separated)</span></label>
                    <input value={jiraIssues} onChange={e => setJiraIssues(e.target.value)} placeholder="QA-123, QA-124, BUG-45"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Project Key <span className="text-slate-600">(fetches all open bugs)</span></label>
                    <input value={jiraProject} onChange={e => setJiraProject(e.target.value)} placeholder="QA"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-slate-400 text-xs mb-1 block">Custom JQL <span className="text-slate-600">(overrides project key)</span></label>
                    <input value={jiraJql} onChange={e => setJiraJql(e.target.value)} placeholder={`project = QA AND sprint in openSprints() AND status = "In Testing"`}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                </div>
                <button onClick={fetchJira} disabled={loading || !jiraUrl || !jiraEmail || !jiraToken}
                  className="bg-blue-600/80 hover:bg-blue-600 disabled:opacity-40 text-white font-bold px-6 py-2.5 rounded-xl transition-colors text-sm flex items-center gap-2">
                  {loading ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin-slow" /> Fetching...</> : '🎯 Fetch from JIRA'}
                </button>
                {failures && !loading && (
                  <div className="bg-slate-800 rounded-xl p-4 max-h-40 overflow-y-auto">
                    <p className="text-slate-500 text-xs mb-2 uppercase tracking-widest">Fetched content preview</p>
                    <pre className="text-slate-300 text-xs font-mono whitespace-pre-wrap">{failures.slice(0, 600)}{failures.length > 600 ? '...' : ''}</pre>
                  </div>
                )}
              </div>
            )}

            {/* ── CONFLUENCE ── */}
            {mode === 'confluence' && (
              <div className="space-y-4">
                <p className="text-slate-400 text-sm">Read a test report, failure log, or QA summary from a Confluence page. Provide the page ID directly, or search by space key + page title.</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Confluence Base URL *</label>
                    <input value={confUrl} onChange={e => setConfUrl(e.target.value)} placeholder="https://yourcompany.atlassian.net/wiki"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Email *</label>
                    <input value={confEmail} onChange={e => setConfEmail(e.target.value)} placeholder="you@company.com"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-slate-400 text-xs mb-1 block">API Token *</label>
                    <input type="password" value={confToken} onChange={e => setConfToken(e.target.value)} placeholder="ATATT3x..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Page ID <span className="text-slate-600">(from page URL)</span></label>
                    <input value={confPageId} onChange={e => setConfPageId(e.target.value)} placeholder="123456789"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Space Key</label>
                    <input value={confSpace} onChange={e => setConfSpace(e.target.value)} placeholder="QA"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-slate-400 text-xs mb-1 block">Page Title <span className="text-slate-600">(used with space key to search)</span></label>
                    <input value={confTitle} onChange={e => setConfTitle(e.target.value)} placeholder="Sprint 23 QA Report"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-rose-500 transition-colors" />
                  </div>
                </div>
                <button onClick={fetchConfluence} disabled={loading || !confUrl || !confEmail || !confToken}
                  className="bg-blue-700/80 hover:bg-blue-700 disabled:opacity-40 text-white font-bold px-6 py-2.5 rounded-xl transition-colors text-sm flex items-center gap-2">
                  {loading ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full spin-slow" /> Fetching...</> : '📘 Fetch from Confluence'}
                </button>
                {failures && !loading && (
                  <div className="bg-slate-800 rounded-xl p-4 max-h-40 overflow-y-auto">
                    <p className="text-slate-500 text-xs mb-2 uppercase tracking-widest">Fetched content preview</p>
                    <pre className="text-slate-300 text-xs font-mono whitespace-pre-wrap">{failures.slice(0, 600)}{failures.length > 600 ? '...' : ''}</pre>
                  </div>
                )}
              </div>
            )}

            {/* Errors & meta */}
            {loadErr && <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">{loadErr}</div>}
            {loadMeta && (
              <div className="mt-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex flex-wrap gap-3">
                {Object.entries(loadMeta).map(([k, v]) => (
                  <span key={k} className="text-emerald-400 text-xs"><span className="text-emerald-600">{k}:</span> {String(v)}</span>
                ))}
              </div>
            )}

            {/* Start button */}
            <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-5">
              <p className="text-slate-600 text-xs">
                {mode === 'paste' ? 'Accepts JUnit XML, Allure output, plain stack traces, or mixed formats' :
                 mode === 'upload' ? 'File is parsed server-side — credentials never stored' :
                 'Credentials used only for this request — never stored or logged'}
              </p>
              <button onClick={handleAnalyze} disabled={!failures.trim()}
                className="bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black px-8 py-3 rounded-xl transition-colors flex items-center gap-2">
                🚀 Start Triage Loop
              </button>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {[
            { icon: '🔄', title: 'True Looping', desc: 'Each step reads the previous step\'s output. The agent builds on its own analysis — not just sequential prompts.' },
            { icon: '🧠', title: 'Self-Correcting', desc: 'Step 5 re-reads everything produced and flags gaps or inconsistencies before delivering the final report.' },
            { icon: '⚡', title: '3 Hours → 45 Seconds', desc: 'What a senior QA engineer does manually every morning after a CI run — fully automated.' },
          ].map(c => (
            <div key={c.title} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="text-2xl mb-3">{c.icon}</div>
              <h3 className="font-bold text-white mb-1">{c.title}</h3>
              <p className="text-slate-400 text-sm">{c.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
