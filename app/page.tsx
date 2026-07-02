'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LOOP_STEPS } from '@/lib/prompts'

const SAMPLE = `FAILED tests/auth/login.spec.ts > should login with valid credentials
Error: Timeout of 5000ms exceeded. At waitForSelector('.dashboard-header')
Stack: at Context.<anonymous> (tests/auth/login.spec.ts:24:5)

FAILED tests/auth/login.spec.ts > should show error for invalid password
Error: Timeout of 5000ms exceeded. At waitForSelector('.error-toast')

FAILED tests/checkout/payment.spec.ts > should process credit card payment
Error: AssertionError: expected 500 to equal 200
Response body: {"error":"Payment gateway connection refused"}

FAILED tests/checkout/payment.spec.ts > should apply discount code
Error: AssertionError: expected 500 to equal 200
Response body: {"error":"Payment gateway connection refused"}

FAILED tests/checkout/payment.spec.ts > should show order confirmation
Error: Element '.order-id' not found after payment step
AssertionError: expected null to not be null

FAILED tests/search/product-search.spec.ts > should return results for keyword
Error: AssertionError: expected [] to have length > 0
Actual response: {"results":[],"total":0}

FAILED tests/auth/logout.spec.ts > should clear session on logout
Error: Timeout of 5000ms exceeded — this test has failed 4 of last 7 runs

FAILED tests/profile/update.spec.ts > should update user email
Error: TypeError: Cannot read properties of undefined (reading 'email')
at ProfilePage.saveChanges (app/profile/page.ts:87:22)`

export default function Home() {
  const router = useRouter()
  const [passcode, setPasscode]   = useState('')
  const [authed, setAuthed]       = useState(false)
  const [authErr, setAuthErr]     = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [failures, setFailures]   = useState('')
  const [charCount, setCharCount] = useState(0)

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true)
    setAuthErr('')
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    })
    if (res.ok) {
      sessionStorage.setItem('qa_authed', '1')
      setAuthed(true)
    } else {
      setAuthErr('Incorrect passcode. Try again.')
    }
    setAuthLoading(false)
  }

  function handleInput(v: string) {
    setFailures(v)
    setCharCount(v.length)
  }

  function loadSample() {
    handleInput(SAMPLE)
  }

  function handleAnalyze() {
    sessionStorage.setItem('qa_failures', failures)
    router.push('/analyze')
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 px-4 py-2 rounded-full mb-6">
              <span className="text-rose-400 text-sm font-bold tracking-widest uppercase">QA Autopilot</span>
            </div>
            <h1 className="text-3xl font-black mb-2">FailSight</h1>
            <p className="text-slate-400">Enter your access passcode to continue</p>
          </div>
          <form onSubmit={handleAuth} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <input
              type="password"
              placeholder="Access passcode"
              value={passcode}
              onChange={e => setPasscode(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
            />
            {authErr && <p className="text-rose-400 text-sm">{authErr}</p>}
            <button
              type="submit"
              disabled={authLoading || !passcode}
              className="w-full bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
            >
              {authLoading ? 'Verifying...' : 'Access QA Autopilot →'}
            </button>
          </form>
          <p className="text-center text-slate-600 text-xs mt-4">
            Built by <a href="https://atulsharma8790.github.io" className="text-slate-500 hover:text-slate-300">Atul Sharma</a> · QA Automation Architect
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 font-black text-sm">QA</div>
          <div>
            <span className="font-black text-white">QA Autopilot</span>
            <span className="text-slate-500 text-sm ml-2">/ FailSight</span>
          </div>
        </div>
        <a href="https://atulsharma8790.github.io" className="text-slate-500 hover:text-slate-300 text-xs transition-colors">← Portfolio</a>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-10">
        {/* Hero */}
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-black mb-4">
            <span className="text-rose-400">Triage 200 failures</span><br/>in 45 seconds
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Paste your CI failure log. QA Autopilot runs a 5-step agentic loop — classifying, clustering, generating root causes and JIRA tickets — then self-reviews its own output.
          </p>
        </div>

        {/* Loop steps preview */}
        <div className="grid grid-cols-5 gap-2 mb-10">
          {LOOP_STEPS.map((step, i) => (
            <div key={step.id} className="relative">
              {i < LOOP_STEPS.length - 1 && (
                <div className="absolute top-6 left-[60%] w-full h-px bg-slate-700 z-0" />
              )}
              <div className="relative z-10 flex flex-col items-center gap-2 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-xl">{step.icon}</div>
                <p className="text-slate-400 text-xs font-medium leading-tight">{step.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Input area */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-3">
            <label className="text-slate-300 font-bold text-sm uppercase tracking-widest">CI Failure Log</label>
            <div className="flex items-center gap-3">
              <span className="text-slate-600 text-xs">{charCount.toLocaleString()} chars</span>
              <button onClick={loadSample} className="text-xs text-rose-400 hover:text-rose-300 border border-rose-500/30 px-3 py-1 rounded-lg transition-colors">
                Load sample
              </button>
            </div>
          </div>
          <textarea
            value={failures}
            onChange={e => handleInput(e.target.value)}
            placeholder={`Paste your CI failures here — JUnit XML, Allure output, plain stack traces, or a mix...\n\nExamples:\n• FAILED tests/auth/login.spec.ts > should login with valid credentials\n  Error: Timeout of 5000ms exceeded\n\n• testcase name="checkout_payment" classname="PaymentTest" time="0.043"\n  <failure>AssertionError: expected 200 but got 500</failure>`}
            className="w-full h-64 bg-slate-800 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 placeholder-slate-600 font-mono resize-none focus:outline-none focus:border-rose-500 transition-colors"
          />
          <div className="flex items-center justify-between mt-4">
            <p className="text-slate-600 text-xs">Accepts: plain text, JUnit XML, Allure JSON/XML, stack traces, copy-paste from CI dashboard</p>
            <button
              onClick={handleAnalyze}
              disabled={!failures.trim()}
              className="bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black px-8 py-3 rounded-xl transition-colors flex items-center gap-2"
            >
              🚀 Start Triage Loop
            </button>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-12 grid md:grid-cols-3 gap-4">
          {[
            { icon: '🔄', title: 'True Looping', desc: 'Each step reads the previous step\'s output — not just sequential prompts. The agent builds on its own analysis.' },
            { icon: '🧠', title: 'Self-Correcting', desc: 'Step 5 is a self-review loop where the AI re-reads everything it produced and flags gaps or inconsistencies.' },
            { icon: '⚡', title: '3 Hours → 45 Seconds', desc: 'What a senior QA engineer does manually every morning after a CI run — fully automated.' },
          ].map(card => (
            <div key={card.title} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="text-2xl mb-3">{card.icon}</div>
              <h3 className="font-bold text-white mb-1">{card.title}</h3>
              <p className="text-slate-400 text-sm">{card.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
