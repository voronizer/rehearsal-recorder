import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { useRestore, useTrash } from "../api"
import { Note, PageHead } from "../shell/parts"
import { clock, day } from "../shell/words"

/**
 * **Trash**: the takes removed in РЭХА, with their files, comments and
 * stars. Anyone in the band can open one and listen, or press **Restore**.
 * After 30 days a take is deleted for good.
 */
export function Trash() {
  const trash = useTrash()
  const restore = useRestore()
  return (
    <>
      <PageHead path={[{ label: "Trash" }]} />
      <div className="flex max-w-2xl flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Trash</h1>
          <p className="text-xs text-muted-foreground">
            Takes removed in РЭХА wait here for 30 days, then they are deleted for good. Anyone in the band can put one back.
          </p>
        </div>
        {trash.error && <Note>{trash.error.message}</Note>}
        {trash.data?.length === 0 && <p className="text-sm text-muted-foreground">The trash is empty.</p>}
        {trash.data && trash.data.length > 0 && (
          <ul className="flex flex-col rounded-xl bg-card">
            {trash.data.map((t, i) => (
              <li key={t.uid} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t" : ""}`}>
                <Link to="/takes/$uid" params={{ uid: t.uid }} className="flex min-w-0 flex-1 flex-col gap-0.5 hover:underline">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground tnum">
                    {day(t.date)} · {clock(t.duration_sec)}
                  </span>
                </Link>
                <Button size="row" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(t.uid)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
