import { useState, type FormEvent } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { client, data, queryClient } from "../api"
import { authClient } from "../auth"
import { Frame } from "./Frame"

const SENT = "If this address is in the band, a code is on its way"
const BAD_CODE = "This code does not work. Check it, or press Send code for a new one."
const TOO_MANY = "Too many tries. Wait a minute, then press Send code again."

/**
 * Signing in: the address and **Send code**, then the code from the letter
 * and **Sign in**. The page answers the same for any address, so it tells
 * a stranger nothing about who is in the band. An address Cloudflare has
 * not had confirmed gets the service's words on what to do instead.
 */
export function SignIn() {
  const { redirect } = useSearch({ from: "/signin" })
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [stage, setStage] = useState<"address" | "code" | "confirm">("address")
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSaid(null)
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" })
    setBusy(false)
    if (!error) {
      setStage("code")
      setCode("")
    } else if (error.status === 429) setSaid(TOO_MANY)
    else if (error.code === "CONFIRM_FIRST") {
      setStage("confirm")
      setSaid(error.message ?? null)
    } else setSaid(error.message ?? "Something went wrong in the band service")
  }

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSaid(null)
    const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() })
    if (error) {
      setBusy(false)
      setSaid(error.status === 429 ? TOO_MANY : BAD_CODE)
      return
    }
    queryClient.clear()
    const me = await data(client.api.me.$get())
    if (!me.name) await navigate({ to: "/name", search: { redirect }, replace: true })
    else await navigate({ href: redirect ?? "/", replace: true })
  }

  return (
    <Frame>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">The band's takes</h1>
        <p className="text-sm text-muted-foreground">
          Type your email address. A letter brings a code to sign in with: no password.
        </p>
      </div>
      <form onSubmit={send} className="flex flex-col gap-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (stage === "confirm") setStage("address")
          }}
        />
        <Button type="submit" variant={stage === "address" || stage === "confirm" ? "default" : "outline"} disabled={busy}>
          Send code
        </Button>
      </form>
      {stage === "confirm" && said && <p className="text-sm">{said}</p>}
      {stage === "code" && (
        <form onSubmit={signIn} className="flex flex-col gap-2">
          <p className="text-sm">{SENT}</p>
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            Sign in
          </Button>
        </form>
      )}
      {stage !== "confirm" && said && (
        <p role="alert" className="text-sm text-destructive">
          {said}
        </p>
      )}
    </Frame>
  )
}
