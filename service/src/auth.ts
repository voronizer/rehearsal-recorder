import { emailOTPClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/** better-auth's own client for signing in with a code: /api/auth on this address. */
export const authClient = createAuthClient({ basePath: "/api/auth", plugins: [emailOTPClient()] })
