import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMe, useSaveName } from "../api"
import { Frame } from "./Frame"

/**
 * The name the band sees on a member's stars and comments: asked the first
 * time they sign in, and changed later with their name at the bottom of
 * the left column.
 */
export function Name() {
  const { redirect } = useSearch({ from: "/name" })
  const navigate = useNavigate()
  const me = useMe()
  const save = useSaveName()
  const [name, setName] = useState("")
  const had = me.data?.name ?? ""
  useEffect(() => setName(had), [had])

  async function submit(e: FormEvent) {
    e.preventDefault()
    await save.mutateAsync(name)
    await navigate({ href: redirect ?? "/", replace: true })
  }

  return (
    <Frame>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">What should the band call you?</h1>
        <p className="text-sm text-muted-foreground">The others see it on your stars, marks and comments.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" autoComplete="given-name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={save.isPending || !me.data}>
          Save
        </Button>
        {had && (
          <Button asChild variant="ghost">
            <Link to="/">Cancel</Link>
          </Button>
        )}
      </form>
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      )}
    </Frame>
  )
}
