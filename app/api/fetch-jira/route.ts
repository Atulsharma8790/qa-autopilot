import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const { baseUrl, email, token, issueKeys, projectKey, jql } = await req.json()

    if (!baseUrl || !email || !token) {
      return NextResponse.json({ error: 'baseUrl, email and token are required' }, { status: 400 })
    }

    const base = baseUrl.replace(/\/$/, '')
    const auth = Buffer.from(`${email}:${token}`).toString('base64')
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    let issues: JiraIssue[] = []

    if (issueKeys?.trim()) {
      // Fetch specific issue keys (comma-separated)
      const keys = issueKeys.split(',').map((k: string) => k.trim()).filter(Boolean)
      for (const key of keys.slice(0, 20)) {
        const res = await fetch(`${base}/rest/api/3/issue/${key}`, { headers })
        if (res.ok) {
          const data = await res.json()
          issues.push(data)
        }
      }
    } else {
      // JQL search — default: open bugs in project
      const query = jql || (projectKey ? `project = ${projectKey} AND issuetype = Bug AND status != Done ORDER BY created DESC` : '')
      if (!query) return NextResponse.json({ error: 'Provide issueKeys, projectKey, or jql' }, { status: 400 })

      const searchUrl = `${base}/rest/api/3/search?jql=${encodeURIComponent(query)}&maxResults=30&fields=summary,description,status,priority,issuetype,comment,attachment`
      const res = await fetch(searchUrl, { headers })
      if (!res.ok) {
        const err = await res.json()
        return NextResponse.json({ error: err.errorMessages?.join(', ') ?? 'JIRA search failed' }, { status: res.status })
      }
      const data = await res.json()
      issues = data.issues ?? []
    }

    if (issues.length === 0) {
      return NextResponse.json({ error: 'No issues found with those parameters' }, { status: 404 })
    }

    // Convert JIRA issues to failure text for triage loop
    const lines: string[] = [`# JIRA Issues imported for triage\n`]
    for (const issue of issues) {
      const fields = issue.fields
      lines.push(`FAILED Issue: ${issue.key} — ${fields.summary}`)
      lines.push(`  Type: ${fields.issuetype?.name ?? 'Bug'} | Priority: ${fields.priority?.name ?? 'Unknown'} | Status: ${fields.status?.name ?? 'Unknown'}`)

      // Extract description text
      if (fields.description) {
        const descText = extractAdfText(fields.description)
        if (descText) lines.push(`  Description: ${descText.slice(0, 400)}`)
      }

      // Last comment
      const comments = fields.comment?.comments ?? []
      if (comments.length > 0) {
        const last = comments[comments.length - 1]
        const commentText = extractAdfText(last.body)
        if (commentText) lines.push(`  Latest comment: ${commentText.slice(0, 200)}`)
      }

      lines.push('')
    }

    return NextResponse.json({
      content: lines.join('\n'),
      meta: { issueCount: issues.length, keys: issues.map((i: JiraIssue) => i.key) },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

interface JiraIssue {
  key: string
  fields: {
    summary: string
    description?: AdfNode
    status?: { name: string }
    priority?: { name: string }
    issuetype?: { name: string }
    comment?: { comments: { body: AdfNode }[] }
    attachment?: unknown[]
  }
}

interface AdfNode {
  type?: string
  text?: string
  content?: AdfNode[]
}

function extractAdfText(adf: AdfNode | string | null | undefined): string {
  if (!adf) return ''
  if (typeof adf === 'string') return adf
  const texts: string[] = []
  function walk(node: AdfNode) {
    if (node.text) texts.push(node.text)
    if (node.content) node.content.forEach(walk)
  }
  walk(adf)
  return texts.join(' ')
}
