import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { passcode } = await req.json()
  if (passcode === process.env.ACCESS_PASSCODE) {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Invalid passcode' }, { status: 401 })
}
