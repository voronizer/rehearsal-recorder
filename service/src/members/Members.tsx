import { useState, type FormEvent } from "react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  useAddMember,
  useKeys,
  useMakeKey,
  useMe,
  useMembers,
  useRemoveKey,
  useRemoveMember,
  useSignOutMember,
  type Member,
} from "../api"
import { Note, PageHead } from "../shell/parts"

/**
 * **Members**, the owner's page: who is in the band, with **Sign out
 * everywhere** for each and **Remove** for each but the owner, **Add
 * member**, and РЭХА's keys.
 */
export function Members() {
  const members = useMembers()
  return (
    <>
      <PageHead path={[{ label: "Members" }]} />
      <div className="flex max-w-2xl flex-col gap-6 p-4 md:p-5">
        <h1 className="text-lg font-semibold">Members</h1>
        {members.error ? (
          <Note>{members.error.message}</Note>
        ) : (
          members.data && (
            <>
              <People members={members.data} />
              <Keys />
            </>
          )
        )}
      </div>
    </>
  )
}

function People({ members }: { members: Member[] }) {
  const me = useMe()
  const add = useAddMember()
  const remove = useRemoveMember()
  const signOut = useSignOutMember()
  const [email, setEmail] = useState("")
  const [removing, setRemoving] = useState<Member | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    await add.mutateAsync(email)
    setEmail("")
  }
  return (
    <section aria-label="The band" className="flex flex-col gap-3">
      <ul className="flex flex-col rounded-xl bg-card">
        {members.map((m, i) => (
          <li key={m.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i > 0 ? "border-t" : ""}`}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{m.name || m.email}</span>
              {m.name && <span className="truncate text-xs text-muted-foreground">{m.email}</span>}
              {!m.confirmed ? (
                <span className="text-xs text-warn">Has not confirmed the address yet</span>
              ) : (
                !m.signed_in && <span className="text-xs text-muted-foreground">Has not signed in yet</span>
              )}
            </span>
            <span className="flex gap-2">
              <Button size="row" variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate(m.id)}>
                Sign out everywhere
              </Button>
              {m.id !== me.data?.id && (
                <Button size="row" variant="outline" disabled={remove.isPending} onClick={() => setRemoving(m)}>
                  Remove
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl bg-card p-4">
        <Label htmlFor="member">Email address</Label>
        <p className="text-xs text-muted-foreground">
          Cloudflare sends them a letter to confirm the address; then they sign in here and give their name.
        </p>
        <span className="flex gap-2">
          <Input id="member" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={add.isPending}>
            Add member
          </Button>
        </span>
        {(add.error ?? remove.error ?? signOut.error) && (
          <p role="alert" className="text-sm text-destructive">
            {(add.error ?? remove.error ?? signOut.error)?.message}
          </p>
        )}
      </form>
      {/* Removing cannot be taken back here, but adding the address again
          brings them back with all they wrote: so the accent, not red. */}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing && `Remove “${removing.name || removing.email}”?`}
        description={
          removing &&
          "They are signed out everywhere and can no longer sign in. Their comments and stars stay. Add the address again to bring them back."
        }
        actionLabel="Remove"
        destructive={false}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </section>
  )
}

/** РЭХА's keys: one for each computer that sends takes here. A new one is shown only once. */
function Keys() {
  const keys = useKeys()
  const make = useMakeKey()
  const remove = useRemoveKey()
  const [name, setName] = useState("")
  const [made, setMade] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const { key } = (await make.mutateAsync(name)) as { key: string }
    setMade(key)
    setName("")
  }
  return (
    <section aria-labelledby="keys" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 px-1">
        <h2 id="keys" className="text-sm font-semibold">
          Keys for РЭХА
        </h2>
        <p className="text-xs text-muted-foreground">РЭХА sends its takes here with a key: one for each computer that records.</p>
      </div>
      {keys.data && keys.data.length > 0 && (
        <ul className="flex flex-col rounded-xl bg-card">
          {keys.data.map((k, i) => (
            <li key={k.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t" : ""}`}>
              <span className="min-w-0 flex-1 truncate text-sm">{k.name}</span>
              <Button size="row" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate(k.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {made && (
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <p className="text-sm">
            Paste this key into РЭХА now, under <b>I have a band service key</b>. It is shown only this once.
          </p>
          <span className="flex items-center gap-2">
            <code data-testid="new-key" className="min-w-0 flex-1 rounded-md bg-secondary px-2 py-1.5 font-mono text-xs break-all select-all">
              {made}
            </code>
            <Button size="row" variant="outline" onClick={() => void navigator.clipboard.writeText(made)}>
              Copy
            </Button>
          </span>
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl bg-card p-4">
        <Label htmlFor="key-name">Where РЭХА runs</Label>
        <span className="flex gap-2">
          <Input id="key-name" required maxLength={32} placeholder="Rehearsal room" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={make.isPending}>
            Make a key for РЭХА
          </Button>
        </span>
        {(make.error ?? remove.error) && (
          <p role="alert" className="text-sm text-destructive">
            {(make.error ?? remove.error)?.message}
          </p>
        )}
      </form>
    </section>
  )
}
