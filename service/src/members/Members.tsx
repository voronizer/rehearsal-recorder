import { useEffect, useRef, useState, type FormEvent } from "react"
import { Ellipsis } from "lucide-react"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  useAddMember,
  useBand,
  useBandPicture,
  useKeys,
  useMakeKey,
  useMe,
  useMembers,
  useNameBand,
  usePeople,
  useRemoveKey,
  useRemoveMember,
  useSignOutMember,
  type Key,
  type Member,
} from "../api"
import { Avatar, Group, Groups, Logo, Note, Page, Rows, Tile } from "../shell/parts"
import { count } from "../shell/words"

const letter = (s: string) => (Array.from(s.trim())[0] ?? "?").toUpperCase()

function Said({ error }: { error: Error | null | undefined }) {
  if (!error) return null
  return (
    <p role="alert" className="text-destructive">
      {error.message}
    </p>
  )
}

/** **The band**, the owner's: its name, saved on Enter or on leaving the box, and its picture. */
function TheBand() {
  const band = useBand()
  const rename = useNameBand()
  const picture = useBandPicture()
  const pick = useRef<HTMLInputElement>(null)
  const saved = band.data?.name ?? ""
  const [name, setName] = useState(saved)
  useEffect(() => setName(saved), [saved])
  if (!band.data) return null
  const save = () => name.trim() !== saved && rename.mutate(name.trim())
  return (
    <Group title="The band">
      <Tile>
        <div className="flex items-center gap-4">
          <Logo name={band.data.name} picture={band.data.picture} className="size-14 rounded-xl text-2xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Input
              value={name}
              maxLength={60}
              aria-label="The band's name"
              placeholder="The band's name"
              onChange={(e) => setName(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={pick}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                aria-label="The band's picture"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) picture.mutate(file)
                }}
              />
              <Button variant="outline" size="row" disabled={picture.isPending} onClick={() => pick.current?.click()}>
                {band.data.picture ? "Change the picture" : "Add a picture"}
              </Button>
              {band.data.picture ? (
                <Button variant="ghost" size="row" disabled={picture.isPending} onClick={() => picture.mutate(null)}>
                  Remove the picture
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Without a picture the logo is the name's first letter.</span>
              )}
            </div>
            <Said error={rename.error ?? picture.error} />
          </div>
        </div>
      </Tile>
    </Group>
  )
}

/** The owner's **People**: addresses, who has not confirmed, and ⋯ with **Sign out everywhere** and **Remove**. */
function People({ members, me }: { members: Member[]; me: string }) {
  const remove = useRemoveMember()
  const signOut = useSignOutMember()
  const [removing, setRemoving] = useState<Member | null>(null)
  const [out, setOut] = useState<string | null>(null)
  const shown = (m: Member) => m.name || m.email
  return (
    <Group title="People" hint={String(members.length)}>
      <Rows>
        {members.map((m) => (
          <div key={m.id} className="flex flex-col gap-2" data-member={m.email}>
            <div className="flex items-center gap-3">
              <Avatar letter={letter(shown(m))} />
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {shown(m)}
                  {m.id === me && <span className="text-muted-foreground"> · you</span>}
                </div>
                {m.name && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                {!m.confirmed ? (
                  <div className="text-xs text-warn">Has not confirmed the address yet</div>
                ) : (
                  !m.signed_in && <div className="text-xs text-muted-foreground">Has not signed in yet</div>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-row" aria-label={`What to do with ${shown(m)}`}>
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => signOut.mutate(m.id, { onSuccess: () => setOut(m.id) })}>Sign out everywhere</DropdownMenuItem>
                  {m.id !== me && (
                    <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
                      Remove
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {out === m.id && (
              <p className="pl-10 text-xs text-muted-foreground">
                {shown(m)} is signed out on every phone and computer. Signing in again takes a new code from a letter.
              </p>
            )}
          </div>
        ))}
      </Rows>
      <Said error={remove.error ?? signOut.error} />
      {/* Removing cannot be taken back here, but adding the address again
          brings them back with all they wrote: so the accent, not red. */}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing && `Remove “${shown(removing)}”?`}
        description={
          removing &&
          "They are signed out everywhere and can no longer sign in. Their marks, comments and stars stay. Add the address again to bring them back."
        }
        actionLabel="Remove"
        destructive={false}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Group>
  )
}

/** **Add a member**: Cloudflare sends a letter to confirm the address. */
function AddMember() {
  const add = useAddMember()
  const [email, setEmail] = useState("")
  async function submit(e: FormEvent) {
    e.preventDefault()
    await add.mutateAsync(email.trim())
    setEmail("")
  }
  return (
    <Group title="Add a member" hint="Cloudflare sends them a letter to confirm the address; then they sign in here and give their name.">
      <form className="flex gap-2" onSubmit={submit}>
        <Input type="email" required aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        <Button type="submit" disabled={add.isPending}>
          Add member
        </Button>
      </form>
      <Said error={add.error} />
    </Group>
  )
}

/** **Keys for РЭХА**: one for each computer that sends takes here, folded once one exists. A new key is shown only once. */
function Keys({ keys }: { keys: Key[] }) {
  const make = useMakeKey()
  const remove = useRemoveKey()
  const [name, setName] = useState("")
  const [made, setMade] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const { key } = (await make.mutateAsync(name.trim())) as { key: string }
    setMade(key)
    setName("")
  }
  return (
    <Group title="Keys for РЭХА" hint={keys.length ? count(keys.length, "key") : undefined} fold={keys.length ? "closed" : "open"}>
      <p className="text-muted-foreground">РЭХА sends its takes here with a key: one for each computer that records.</p>
      {keys.length > 0 && (
        <Rows>
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate">{k.name}</span>
              <Button variant="ghost" size="row" disabled={remove.isPending} onClick={() => remove.mutate(k.id)}>
                Remove
              </Button>
            </div>
          ))}
        </Rows>
      )}
      {made && (
        <Tile boxed className="border-primary/40">
          <span>
            Paste this key into РЭХА now, under <b>I have a band service key</b>. It is shown only this once.
          </span>
          <span className="flex items-center gap-2">
            <code data-testid="new-key" className="min-w-0 flex-1 rounded-md bg-secondary px-2 py-1.5 font-mono text-xs break-all select-all">
              {made}
            </code>
            <Button size="row" variant="outline" onClick={() => void navigator.clipboard.writeText(made).catch(() => {})}>
              Copy
            </Button>
          </span>
        </Tile>
      )}
      <form className="flex gap-2" onSubmit={submit}>
        <Input
          required
          maxLength={32}
          aria-label="Where РЭХА runs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Where РЭХА runs, such as Rehearsal room"
        />
        <Button type="submit" disabled={make.isPending}>
          Make a key for РЭХА
        </Button>
      </form>
      <Said error={make.error ?? remove.error} />
    </Group>
  )
}

/** The owner's page: the band, its people with what he can do, adding a member, РЭХА's keys. */
function OwnersPage({ me }: { me: string }) {
  const members = useMembers()
  const keys = useKeys()
  if (members.error) return <Note>{members.error.message}</Note>
  if (!members.data || !keys.data) return null
  return (
    <Page title="Members" sub="Only you see the addresses, the buttons and the keys.">
      <Groups>
        <TheBand />
        <People members={members.data} me={me} />
        <AddMember />
        <Keys keys={keys.data} />
      </Groups>
    </Page>
  )
}

/** A member's page: who is in the band, names only. */
function MembersPage() {
  const people = usePeople()
  if (people.error) return <Note>{people.error.message}</Note>
  if (!people.data) return null
  return (
    <Page title="Members" sub="Who is in the band.">
      <Group title="People" hint={String(people.data.length)}>
        <Rows>
          {people.data.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <Avatar letter={p.initial} />
              <span className="min-w-0 flex-1 truncate">
                {p.name}
                {p.me && <span className="text-muted-foreground"> · you</span>}
              </span>
            </div>
          ))}
        </Rows>
      </Group>
    </Page>
  )
}

/** **Members**: everyone sees who is in the band; the owner also runs it from here. */
export function Members() {
  const me = useMe().data
  if (!me) return null
  return me.owner ? <OwnersPage me={me.id} /> : <MembersPage />
}
