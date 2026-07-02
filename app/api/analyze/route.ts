import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt, buildUserPrompt } from '@/lib/prompts'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function send(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
}

/** Robustly extract an array from a JSON chunk — handles wrapped objects too */
function extractArray(chunk: string): unknown[] | null {
  // Try direct array first
  const arrMatch = chunk.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0])
      if (Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }
  // Try object with any array-valued key
  const objMatch = chunk.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0])
      if (parsed && typeof parsed === 'object') {
        for (const val of Object.values(parsed)) {
          if (Array.isArray(val)) return val
        }
      }
    } catch { /* continue */ }
  }
  return null
}

/** Robustly extract an object from a JSON chunk */
function extractObject(chunk: string): Record<string, unknown> | null {
  const objMatch = chunk.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }
  return null
}

function parseSteps(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const stepKeys = ['STEP_1', 'STEP_2', 'STEP_3', 'STEP_4', 'STEP_5']

  for (let i = 0; i < stepKeys.length; i++) {
    const startMarker = `${stepKeys[i]}_START`
    const nextMarker  = i < stepKeys.length - 1 ? `${stepKeys[i + 1]}_START` : null

    const startIdx = text.indexOf(startMarker)
    if (startIdx === -1) continue

    const chunk = nextMarker && text.indexOf(nextMarker) !== -1
      ? text.slice(startIdx + startMarker.length, text.indexOf(nextMarker))
      : text.slice(startIdx + startMarker.length)

    const key = `step${i + 1}`

    if (i < 4) {
      // Steps 1–4 expect arrays
      const arr = extractArray(chunk)
      if (arr) { result[key] = arr; continue }
    }
    // Step 5 (or fallback) expects an object
    const obj = extractObject(chunk)
    if (obj) result[key] = obj
  }

  return result
}

export async function POST(req: Request) {
  const { failures } = await req.json()
  if (!failures?.trim()) {
    return new Response('No failures provided', { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        send(controller, { type: 'status', step: 0, message: 'Starting QA Autopilot loop...' })

        let fullText = ''
        let currentStep = 0

        const anthropicStream = await client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: buildSystemPrompt(),
          messages: [{ role: 'user', content: buildUserPrompt(failures) }],
        })

        for await (const chunk of anthropicStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            const text = chunk.delta.text
            fullText += text

            const stepMatch = fullText.match(/STEP_(\d)_START/g)
            if (stepMatch) {
              const stepNum = parseInt(stepMatch[stepMatch.length - 1].replace('STEP_', '').replace('_START', ''))
              if (stepNum !== currentStep) {
                currentStep = stepNum
                send(controller, { type: 'step_start', step: currentStep })
              }
            }

            send(controller, { type: 'token', text })
          }
        }

        const steps = parseSteps(fullText)
        send(controller, { type: 'complete', steps })

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error'
        send(controller, { type: 'error', message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
