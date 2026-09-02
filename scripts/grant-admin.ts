/**
 * Make one account the administrator, or stop it being one.
 *
 *   npx tsx --env-file=.env.local scripts/grant-admin.ts you@example.com
 *   npx tsx --env-file=.env.local scripts/grant-admin.ts you@example.com --revoke
 *
 * Runs under Application Default Credentials (`gcloud auth application-default login`), like
 * every script here; `--env-file` supplies NEXT_PUBLIC_FB_PROJECT_ID for the Admin SDK. The
 * claim is written onto the uid, so it survives an email change and never depends on the
 * address being verified. It reaches the browser on the next ID-token refresh — up to an
 * hour — or at once on the next sign-in, which is why the output says to sign out and in.
 *
 * No top-level await: tsx compiles this to CJS, where it is a syntax error.
 */
import { withAdminClaim } from '../src/lib/adminUsers'
import { adminAuth } from '../src/lib/firebase/admin'

async function main() {
  const [email, flag] = process.argv.slice(2)
  if (!email || (flag !== undefined && flag !== '--revoke')) {
    console.error('usage: grant-admin.ts <email> [--revoke]')
    process.exit(2)
  }
  const grant = flag !== '--revoke'
  const user = await adminAuth.getUserByEmail(email)
  const claims = withAdminClaim(user.customClaims, grant)
  await adminAuth.setCustomUserClaims(user.uid, claims)
  // Read back rather than echo the input: what is printed is what Firebase now holds.
  const after = await adminAuth.getUser(user.uid)
  console.log(`${grant ? 'granted' : 'revoked'} admin for ${email} (${user.uid})`)
  console.log(`claims now: ${JSON.stringify(after.customClaims ?? {})}`)
  console.log('Sign out and back in to see it take effect now; otherwise within the hour.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
