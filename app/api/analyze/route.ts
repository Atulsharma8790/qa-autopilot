import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt, buildUserPrompt } from '@/lib/prompts'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function send(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
}

function extractArray(chunk: string): unknown[] | null {
  const arrMatch = chunk.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try { const p = JSON.parse(arrMatch[0]); if (Array.isArray(p)) return p } catch { /* */ }
  }
  const objMatch = chunk.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const p = JSON.parse(objMatch[0])
      if (p && typeof p === 'object') for (const v of Object.values(p)) if (Array.isArray(v)) return v
    } catch { /* */ }
  }
  return null
}

function extractObject(chunk: string): Record<string, unknown> | null {
  const objMatch = chunk.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try { const p = JSON.parse(objMatch[0]); if (p && !Array.isArray(p)) return p } catch { /* */ }
  }
  return null
}

function parseStepChunk(chunk: string, stepIndex: number): unknown {
  if (stepIndex < 4) return extractArray(chunk) ?? { raw: chunk.trim().slice(0, 300) }
  return extractObject(chunk) ?? { raw: chunk.trim().slice(0, 300) }
}

export async function POST(req: Request) {
  const { failures } = await req.json()
  if (!failures?.trim()) return new Response('No failures provided', { status: 400 })

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let fullText = ''
        let currentStep = 0
        let stepStartIdx: Record<number, number> = {}

        const anthropicStream = await client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: buildSystemPrompt(),
          messages: [{ role: 'user', content: buildUserPrompt(failures) }],
        })

        for await (const chunk of anthropicStream) {
          if (chunk.type !== 'content_block_delta' || chunk.delta.type !== 'text_delta') continue
          const text = chunk.delta.text
          fullText += text

          // Detect new step markers
          for (let s = 1; s <= 5; s++) {
            const marker = `STEP_${s}_START`
            if (fullText.includes(marker) && !stepStartIdx[s]) {
              stepStartIdx[s] = fullText.indexOf(marker)

              // When step N starts, we can emit the parsed result of step N-1
              if (s > 1) {
                const prevStep = s - 1
                const prevStart = stepStartIdx[prevStep]
                const prevChunk = fullText.slice(prevStart + `STEP_${prevStep}_START`.length, stepStartIdx[s])
                const parsed = parseStepChunk(prevChunk, prevStep - 1)
                send(controller, { type: 'step_result', step: prevStep, data: parsed })
              }

              if (s !== currentStep) {
                currentStep = s
                send(controller, { type: 'step_start', step: currentStep })
              }
            }
          }

          // Stream live tokens so the UI can show what's happening right now
          send(controller, { type: 'token', text, step: currentStep })
        }

        // Parse and emit the last step (step 5)
        if (stepStartIdx[5]) {
          const lastChunk = fullText.slice(stepStartIdx[5] + 'STEP_5_START'.length)
          const parsed = parseStepChunk(lastChunk, 4)
          send(controller, { type: 'step_result', step: 5, data: parsed })
        }

        send(controller, { type: 'complete' })

      } catch (e: unknown) {
        send(controller, { type: 'error', message: e instanceof Error ? e.message : 'Unknown error' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
