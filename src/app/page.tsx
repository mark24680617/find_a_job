import { cookies } from 'next/headers'
import { DashboardScreen } from '@/components/board/DashboardScreen'
import { SIGNED_IN_COOKIE } from '@/lib/landing/firstPaint'

// The one route two kinds of visitor share. The server reads a hint — has this browser signed
// in here before — and the screen uses it to decide what to paint while Firebase restores the
// session. Everything else about the dashboard lives in the client screen.

export default async function HomePage() {
  const returning = (await cookies()).has(SIGNED_IN_COOKIE)
  return <DashboardScreen returning={returning} />
}
