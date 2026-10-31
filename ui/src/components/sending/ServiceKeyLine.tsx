import { useState } from "react"
import { KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SAID } from "@/components/SettingsGroup"
import { dismiss } from "@/lib/notices"
import { api } from "@/lib/api"

/**
 * The quiet line at the bottom of the cloud folder's group, for a band that
 * has a band service. Pressed, it says what one is, above a field for its
 * key. A key the service turns down says why under the field; one it takes
 * turns the group into Sending takes (`onConnected`, with whether the
 * service could be asked at all).
 */
export function ServiceKeyLine({ onConnected }: { onConnected: (unchecked: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    if (busy || !key.trim()) return
    dismiss(SAID)
    setBusy(true)
    setError(null)
    const res = await api().set_service_key(key)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? "This key does not work")
      return
    }
    onConnected(Boolean(res.unchecked))
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="row"
        className="self-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <KeyRound />I have a band service key
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        A band service is a private web page where your band listens to its takes track by track,
        stars the good ones and talks about them. Whoever runs it gives you a key to paste here. You
        can run one for your own band too:{" "}
        <Button
          variant="link"
          className="inline h-auto rounded-sm p-0 text-sm whitespace-normal"
          onClick={() => void api().open_service_help()}
        >
          How it works
        </Button>
        .
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="Band service key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void connect()
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "service-key-error" : undefined}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          className="shrink-0"
          disabled={busy || !key.trim()}
          onClick={() => void connect()}
        >
          Connect
        </Button>
      </div>
      {error && (
        <p id="service-key-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
