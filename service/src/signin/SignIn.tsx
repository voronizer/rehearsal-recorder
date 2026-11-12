import { useState, type FormEvent } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import { client, data, queryClient } from "../api"
import { authClient } from "../auth"
import { ErrorLine } from "../shell/parts"
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
  // What the page says, and which press it answers: Send code's under the
  // address, Sign in's under the code.
  const [said, setSaid] = useState<{ text: string; by: "send" | "sign" } | null>(null)
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
    } else if (error.code === "TOO_MANY_CODES") setSaid({ text: error.message ?? TOO_MANY, by: "send" })
    else if (error.status === 429) setSaid({ text: TOO_MANY, by: "send" })
    else if (error.code === "CONFIRM_FIRST") {
      setStage("confirm")
      setSaid(error.message ? { text: error.message, by: "send" } : null)
    } else setSaid({ text: error.message ?? "Something went wrong in the band service", by: "send" })
  }

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSaid(null)
    const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() })
    if (error) {
      setBusy(false)
      setSaid({ text: error.status === 429 ? TOO_MANY : BAD_CODE, by: "sign" })
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
        <h1 className="text-base font-semibold">The band's takes</h1>
        <p className="text-sm text-muted-foreground">
          Type your email address. A letter brings a code to sign in with: no password.
        </p>
      </div>
      <form onSubmit={send} className="flex flex-col gap-2">
        <Label htmlFor="email">Email address</Label>
        {/* What went wrong in the line under the field, there when empty (S11). */}
        <Field className="gap-1">
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
          <ErrorLine error={stage !== "confirm" && said?.by === "send" ? said.text : undefined} />
        </Field>
        <Button type="submit" variant={stage === "address" || stage === "confirm" ? "default" : "outline"} disabled={busy}>
          Send code
        </Button>
      </form>
      {stage === "confirm" && said && <p className="text-sm">{said.text}</p>}
      {stage === "code" && (
        <form onSubmit={signIn} className="flex flex-col gap-2">
          <p className="text-sm">{SENT}</p>
          <Label htmlFor="code">Code</Label>
          {/* Six boxes, a digit in each (S17): the phone still offers the code
              from the letter, and the whole code pasted fills all six. */}
          <Field className="gap-1">
            <InputOTP
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="^[0-9]+$"
              pasteTransformer={(text) => text.replace(/[^0-9]/g, "")}
              maxLength={6}
              minLength={6}
              required
              value={code}
              onChange={setCode}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <ErrorLine error={said?.by === "sign" ? said.text : undefined} />
          </Field>
          <Button type="submit" disabled={busy}>
            Sign in
          </Button>
        </form>
      )}
    </Frame>
  )
}
