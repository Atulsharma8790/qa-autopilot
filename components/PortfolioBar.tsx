'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const PORTFOLIO_URL = 'https://atulsharma.vercel.app'

export default function PortfolioBar() {
  const searchParams = useSearchParams()
  const [fromPortfolio, setFromPortfolio] = useState(false)

  useEffect(() => {
    // Show back button if arrived via ?ref=portfolio OR referrer is the portfolio
    const refParam = searchParams.get('ref') === 'portfolio'
    const refHeader = typeof document !== 'undefined' && document.referrer.includes('atulsharma.vercel.app')
    setFromPortfolio(refParam || refHeader)
  }, [searchParams])

  return (
    <div className="w-full flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-black/30 backdrop-blur text-xs text-slate-500">
      {fromPortfolio ? (
        <a
          href={PORTFOLIO_URL}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors font-medium"
        >
          ← Back to Portfolio
        </a>
      ) : (
        <span />
      )}
      <a
        href={PORTFOLIO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-slate-300 transition-colors"
      >
        Built by <span className="text-white font-semibold">Atul Sharma</span>
      </a>
    </div>
  )
}
