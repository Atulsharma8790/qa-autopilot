import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

/** Convert uploaded file to plain text that the triage loop can analyse */
export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const text = await file.text()
    const name = file.name.toLowerCase()

    let extracted = ''

    if (name.endsWith('.xml') || text.trimStart().startsWith('<')) {
      extracted = extractFromXml(text, name)
    } else if (name.endsWith('.json')) {
      extracted = extractFromJson(text)
    } else {
      // Plain text, CSV, log files — use as-is
      extracted = text
    }

    if (!extracted.trim()) {
      return NextResponse.json({ error: 'Could not extract failure content from file' }, { status: 422 })
    }

    return NextResponse.json({ content: extracted.slice(0, 50000) }) // 50k char cap
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

function extractFromXml(xml: string, filename: string): string {
  const lines: string[] = []

  // JUnit / TestNG / Surefire XML  — <testcase> with <failure> or <error>
  const testcaseRe = /<testcase[^>]*classname="([^"]*)"[^>]*name="([^"]*)"[^>]*(?:time="([^"]*)")?[^>]*>([\s\S]*?)<\/testcase>/g
  let m: RegExpExecArray | null
  while ((m = testcaseRe.exec(xml)) !== null) {
    const [, classname, name, , body] = m
    const failMatch = body.match(/<(?:failure|error)[^>]*(?:message="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:failure|error)>/)
    if (failMatch) {
      lines.push(`FAILED ${classname} > ${name}`)
      if (failMatch[1]) lines.push(`  Message: ${failMatch[1]}`)
      if (failMatch[2]?.trim()) lines.push(`  ${failMatch[2].trim().slice(0, 400)}`)
      lines.push('')
    }
  }

  if (lines.length === 0) {
    // Fallback: extract any <failure> or <error> tags
    const fallback = xml.match(/<(?:failure|error)[^>]*>([\s\S]*?)<\/(?:failure|error)>/g) ?? []
    fallback.forEach(f => lines.push(f.replace(/<[^>]+>/g, '').trim()))
  }

  return lines.length > 0 ? lines.join('\n') : xml.slice(0, 10000)
}

function extractFromJson(json: string): string {
  try {
    const data = JSON.parse(json)
    const lines: string[] = []

    // Allure JSON (array of test results)
    if (Array.isArray(data)) {
      data.forEach((item: Record<string, unknown>) => {
        const status = item.status as string
        if (status === 'failed' || status === 'broken') {
          const name = (item.name ?? item.fullName ?? 'Unknown test') as string
          lines.push(`FAILED ${name}`)
          const statusDetail = item.statusDetails as Record<string, string> | undefined
          if (statusDetail?.message) lines.push(`  Error: ${statusDetail.message}`)
          if (statusDetail?.trace) lines.push(`  ${statusDetail.trace.slice(0, 300)}`)
          lines.push('')
        }
      })
    }

    // GitHub Actions check_runs style
    if (data.check_runs || data.jobs) {
      const runs = (data.check_runs ?? data.jobs ?? []) as Record<string, unknown>[]
      runs.forEach((run: Record<string, unknown>) => {
        if (run.conclusion === 'failure') {
          lines.push(`FAILED ${run.name}`)
          if (run.output) {
            const out = run.output as Record<string, string>
            if (out.title) lines.push(`  ${out.title}`)
            if (out.summary) lines.push(`  ${out.summary?.slice(0, 300)}`)
          }
          lines.push('')
        }
      })
    }

    return lines.length > 0 ? lines.join('\n') : JSON.stringify(data, null, 2).slice(0, 10000)
  } catch {
    return json.slice(0, 10000)
  }
}
