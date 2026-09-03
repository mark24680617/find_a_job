import { cookies } from 'next/headers'
import { SignInScreen } from '@/components/SignInScreen'
import { SIGNED_IN_COOKIE } from '@/lib/landing/firstPaint'

// /sign-in and /sign-in?mode=sign-up. The mode is read here, on the server, so the client
// never has to suspend on the URL to know which half of the wall to open.

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const { mode } = await searchParams
  const returning = (await cookies()).has(SIGNED_IN_COOKIE)
  return <SignInScreen mode={mode === 'sign-up' ? 'sign-up' : 'sign-in'} returning={returning} />
}
