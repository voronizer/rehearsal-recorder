import { useLinks } from "../api"
import { Group, Trouble } from "../shell/parts"
import { LinkList } from "./LinkWindow"

/*
  Every open link of the band on **Members and links** (Alex's pick А,
  2026-11-15 22:56), right after **People**, on the owner's page and on a
  member's: any member copies or closes any of them. Each title starts with
  the take's name, which opens the take.
*/
export function BandLinks() {
  const links = useLinks()
  return (
    <Group title="Links for people outside the band" hint={links.data?.length ? String(links.data.length) : undefined}>
      {links.error ? (
        <Trouble error={links.error} retry={() => void links.refetch()} />
      ) : !links.data ? null : links.data.length ? (
        <LinkList links={links.data} withTake />
      ) : (
        <p className="text-muted-foreground">No links yet.</p>
      )}
    </Group>
  )
}
