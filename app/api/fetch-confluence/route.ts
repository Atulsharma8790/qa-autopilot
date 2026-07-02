import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const { baseUrl, email, token, pageId, spaceKey, title } = await req.json()

    if (!baseUrl || !email || !token) {
      return NextResponse.json({ error: 'baseUrl, email and token are required' }, { status: 400 })
    }

    const base = baseUrl.replace(/\/$/, '')
    const auth = Buffer.from(`${email}:${token}`).toString('base64')
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' }

    let resolvedPageId = pageId

    // Search by title + space if no pageId
    if (!resolvedPageId && (spaceKey || title)) {
      let cql = ''
      if (spaceKey && title) cql = `type=page AND space="${spaceKey}" AND title="${title}"`
      else if (spaceKey)    cql = `type=page AND space="${spaceKey}" ORDER BY lastModified DESC`
      else                  cql = `type=page AND title="${title}"`

      const searchRes = await fetch(
        `${base}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=5`,
        { headers }
      )
      if (!searchRes.ok) {
        const err = await searchRes.json()
        return NextResponse.json({ error: err.message ?? 'Confluence search failed' }, { status: searchRes.status })
      }
      const searchData = await searchRes.json()
      if (!searchData.results?.length) {
        return NextResponse.json({ error: 'No Confluence pages found with those parameters' }, { status: 404 })
      }
      resolvedPageId = searchData.results[0].id
    }

    if (!resolvedPageId) {
      return NextResponse.json({ error: 'Provide pageId, spaceKey, or title' }, { status: 400 })
    }

    // Fetch page body (storage format)
    const pageRes = await fetch(
      `${base}/rest/api/content/${resolvedPageId}?expand=body.storage,title,space`,
      { headers }
    )
    if (!pageRes.ok) {
      const err = await pageRes.json()
      return NextResponse.json({ error: err.message ?? 'Page not found' }, { status: pageRes.status })
    }
    const page = await pageRes.json()

    const rawHtml = page.body?.storage?.value ?? ''
    const text = htmlToText(rawHtml)

    // Extract failure-looking lines for better triage
    const lines = text.split('\n')
    const failureLines = lines.filter(l =>
      /fail|error|exception|assert|timeout|FAILED|ERROR|BROKEN/i.test(l)
    )

    const content = [
      `# Confluence Page: ${page.title}`,
      `# Space: ${page.space?.name ?? 'Unknown'}`,
      `# Page ID: ${resolvedPageId}`,
      '',
      failureLines.length > 10
        ? `# Failure-relevant content extracted:\n${failureLines.join('\n')}`
        : `# Full page content:\n${text}`,
    ].join('\n')

    return NextResponse.json({
      content: content.slice(0, 50000),
      meta: { pageTitle: page.title, pageId: resolvedPageId, failureLinesFound: failureLines.length },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
