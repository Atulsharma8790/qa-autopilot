import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

interface JiraTicketInput {
  jiraTitle: string
  severity: string
  type: string
  stepsToReproduce: string[]
  expectedBehaviour: string
  actualBehaviour: string
  suggestedFix: string
  affectedTests: string[]
  labels: string[]
}

const SEVERITY_PRIORITY: Record<string, string> = {
  critical: 'Highest',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
}

export async function POST(req: Request) {
  try {
    const { baseUrl, email, token, projectKey, tickets } = await req.json()

    if (!baseUrl || !email || !token || !projectKey) {
      return NextResponse.json({ error: 'baseUrl, email, token and projectKey are required' }, { status: 400 })
    }
    if (!Array.isArray(tickets) || tickets.length === 0) {
      return NextResponse.json({ error: 'No tickets to create' }, { status: 400 })
    }

    const base = baseUrl.replace(/\/$/, '')
    const auth = Buffer.from(`${email}:${token}`).toString('base64')
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    // Verify project exists first
    const projRes = await fetch(`${base}/rest/api/3/project/${projectKey}`, { headers })
    if (!projRes.ok) {
      return NextResponse.json({ error: `Project "${projectKey}" not found or not accessible` }, { status: 404 })
    }

    const created: { key: string; url: string; title: string }[] = []
    const failed:  { title: string; error: string }[] = []

    for (const ticket of tickets as JiraTicketInput[]) {
      const stepsText = ticket.stepsToReproduce
        ?.map((s, i) => `${i + 1}. ${s}`)
        .join('\n') ?? ''

      const description = {
        version: 1,
        type: 'doc',
        content: [
          paragraph(`*Steps to Reproduce:*\n${stepsText}`),
          paragraph(`*Expected:* ${ticket.expectedBehaviour}`),
          paragraph(`*Actual:* ${ticket.actualBehaviour}`),
          paragraph(`*Suggested Fix:* ${ticket.suggestedFix}`),
          paragraph(`*Affected Tests:* ${ticket.affectedTests?.join(', ') ?? ''}`),
          paragraph(`_Created by QA Autopilot (FailSight)_`),
        ],
      }

      const body = {
        fields: {
          project:     { key: projectKey },
          summary:     ticket.jiraTitle,
          description,
          issuetype:   { name: ticket.type || 'Bug' },
          priority:    { name: SEVERITY_PRIORITY[ticket.severity?.toLowerCase()] ?? 'Medium' },
          labels:      ticket.labels ?? [],
        },
      }

      const res = await fetch(`${base}/rest/api/3/issue`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (res.ok) {
        const data = await res.json()
        created.push({
          key: data.key,
          url: `${base}/browse/${data.key}`,
          title: ticket.jiraTitle,
        })
      } else {
        const err = await res.json().catch(() => ({}))
        const errMsg = err.errors
          ? Object.values(err.errors).join(', ')
          : err.errorMessages?.join(', ') ?? `HTTP ${res.status}`
        failed.push({ title: ticket.jiraTitle, error: errMsg })
      }
    }

    return NextResponse.json({ created, failed, total: tickets.length })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

function paragraph(text: string) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  }
}
