import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const { owner, repo, runId, token, branch } = await req.json()

    if (!owner || !repo) {
      return NextResponse.json({ error: 'owner and repo are required' }, { status: 400 })
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    let resolvedRunId = runId

    // If no runId, get the latest failed run on the branch (or main)
    if (!resolvedRunId) {
      const branch_ = branch || 'main'
      const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${branch_}&status=failure&per_page=1`
      const runsRes = await fetch(runsUrl, { headers })
      if (!runsRes.ok) {
        const err = await runsRes.json()
        return NextResponse.json({ error: err.message ?? 'GitHub API error fetching runs' }, { status: runsRes.status })
      }
      const runsData = await runsRes.json()
      if (!runsData.workflow_runs?.length) {
        return NextResponse.json({ error: `No failed runs found on branch "${branch_}"` }, { status: 404 })
      }
      resolvedRunId = runsData.workflow_runs[0].id
    }

    // Get the jobs for this run
    const jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${resolvedRunId}/jobs`
    const jobsRes = await fetch(jobsUrl, { headers })
    if (!jobsRes.ok) {
      const err = await jobsRes.json()
      return NextResponse.json({ error: err.message ?? 'GitHub API error fetching jobs' }, { status: jobsRes.status })
    }
    const jobsData = await jobsRes.json()

    const lines: string[] = [`# GitHub Actions Failures\n# Repo: ${owner}/${repo} | Run ID: ${resolvedRunId}\n`]

    for (const job of jobsData.jobs ?? []) {
      if (job.conclusion !== 'failure') continue
      lines.push(`FAILED Job: ${job.name}`)

      for (const step of job.steps ?? []) {
        if (step.conclusion === 'failure') {
          lines.push(`  Failed Step: ${step.name}`)
        }
      }

      // Fetch job logs (up to first 3 failed jobs to stay within limits)
      if (token && lines.length < 200) {
        try {
          const logRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
            { headers }
          )
          if (logRes.ok) {
            const log = await logRes.text()
            // Extract error lines from log
            const errLines = log.split('\n')
              .filter(l => /error|fail|exception|assert/i.test(l))
              .slice(0, 20)
              .map(l => `  ${l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.Z]+ /, '').trim()}`)
            lines.push(...errLines)
          }
        } catch { /* logs optional */ }
      }
      lines.push('')
    }

    const content = lines.join('\n')
    if (lines.length <= 2) {
      return NextResponse.json({ error: 'No failed jobs found in this run' }, { status: 404 })
    }

    return NextResponse.json({
      content,
      meta: {
        runId: resolvedRunId,
        repo: `${owner}/${repo}`,
        failedJobs: jobsData.jobs?.filter((j: { conclusion: string }) => j.conclusion === 'failure').length ?? 0,
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
