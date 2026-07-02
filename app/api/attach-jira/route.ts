import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const baseUrl  = form.get('baseUrl') as string
    const email    = form.get('email')   as string
    const token    = form.get('token')   as string
    const issueKey = form.get('issueKey') as string
    const file     = form.get('file')    as File | null

    if (!baseUrl || !email || !token || !issueKey || !file) {
      return NextResponse.json({ error: 'baseUrl, email, token, issueKey and file are required' }, { status: 400 })
    }

    const base = baseUrl.replace(/\/$/, '')
    const auth = Buffer.from(`${email}:${token}`).toString('base64')

    const body = new FormData()
    const bytes = await file.arrayBuffer()
    body.append('file', new Blob([bytes], { type: file.type || 'application/octet-stream' }), file.name)

    const res = await fetch(`${base}/rest/api/3/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'X-Atlassian-Token': 'no-check',
        Accept: 'application/json',
      },
      body,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.errors ? Object.values(err.errors).join(', ') : `HTTP ${res.status}` }, { status: res.status })
    }

    const data = await res.json()
    const attached = Array.isArray(data) ? data[0] : data
    return NextResponse.json({ filename: attached?.filename ?? file.name, id: attached?.id })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
