import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt, buildUserPrompt } from '@/lib/prompts'

export const runtime = 'nodejs'
export const maxDuration = 120

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function send(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
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

            // Detect step transitions
            const stepMatch = fullText.match(/STEP_(\d)_START/)
            if (stepMatch) {
              const stepNum = parseInt(stepMatch[1])
              if (stepNum !== currentStep) {
                currentStep = stepNum
                send(controller, { type: 'step_start', step: currentStep })
              }
            }

            send(controller, { type: 'token', text })
          }
        }

        // Parse and emit structured results per step
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

function parseSteps(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const stepKeys = ['STEP_1', 'STEP_2', 'STEP_3', 'STEP_4', 'STEP_5']

  for (let i = 0; i < stepKeys.length; i++) {
    const startMarker = `${stepKeys[i]}_START`
    const endMarker   = i < stepKeys.length - 1 ? `${stepKeys[i + 1]}_START` : null

    const startIdx = text.indexOf(startMarker)
    if (startIdx === -1) continue

    const chunk = endMarker
      ? text.slice(startIdx + startMarker.length, text.indexOf(endMarker))
      : text.slice(startIdx + startMarker.length)

    // Extract JSON from chunk
    const jsonMatch = chunk.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (jsonMatch) {
      try {
        result[`step${i + 1}`] = JSON.parse(jsonMatch[0])
      } catch {
        result[`step${i + 1}`] = { raw: chunk.trim().slice(0, 500) }
      }
    }
  }

  return result
}
