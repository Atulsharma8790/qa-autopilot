import { Suspense } from 'react'
import type { Metadata } from 'next'
import './globals.css'
import PortfolioBar from '@/components/PortfolioBar'


export const metadata: Metadata = {
  title: 'QA Autopilot (FailSight) — AI CI Failure Triage',
  description: 'Paste CI failures. Watch AI loop through classification, root cause, clustering, and JIRA tickets — in 45 seconds.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0a0f] text-slate-100 antialiased">
        <Suspense fallback={null}><PortfolioBar /></Suspense>{children}</body>
    </html>
  )
}
