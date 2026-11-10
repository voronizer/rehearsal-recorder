import type { ReactNode } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { cn } from "@/lib/utils"

/**
 * A list put in order by dragging its rows by a handle: Settings › Marks
 * today, the evening's plan next. dnd-kit does the dragging — the pointer,
 * the rows making room, the keyboard (Space on the handle, then the arrows)
 * — and is used nowhere else, so a change in its API, which a 0.x release
 * may bring, is a change to this file alone.
 *
 * `onMove` hears where a row was dropped. The list shows `items` as given:
 * the caller puts the new order in place at once, so the row does not jump
 * back while the change is saved. The rows are split by 1 px lines, as a
 * group's rows are (C7), and each keeps its own padding; `lines={false}`
 * leaves the lines out, as the band service's lists have none.
 */
export function SortableList<T extends { id: number | string }>({
  items,
  label,
  onMove,
  lines = true,
  children,
}: {
  items: T[]
  /** The list's name, for a screen reader and for tests. */
  label: string
  onMove: (id: T["id"], to: number) => void
  lines?: boolean
  /** One row. `handleRef` goes on the element it is dragged by. */
  children: (item: T, handleRef: (el: Element | null) => void) => ReactNode
}) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        const { source } = event.operation
        if (event.canceled || !isSortable(source)) return
        // Picked up and put back where it was: nothing moved.
        if (source.initialIndex === source.index) return
        onMove(source.id as T["id"], source.index)
      }}
    >
      <ul aria-label={label} className="flex flex-col">
        {items.map((item, index) => (
          <SortableRow key={item.id} id={item.id} index={index} lines={lines}>
            {(handleRef) => children(item, handleRef)}
          </SortableRow>
        ))}
      </ul>
    </DragDropProvider>
  )
}

function SortableRow({
  id,
  index,
  lines,
  children,
}: {
  id: number | string
  index: number
  lines: boolean
  children: (handleRef: (el: Element | null) => void) => ReactNode
}) {
  const { ref, handleRef, isDragging } = useSortable({ id, index })
  return (
    <li
      ref={ref}
      className={cn(
        lines && "not-first:border-t",
        // In hand, it is lifted off the list, with no line of its own.
        isDragging && "relative z-10 rounded-lg border-transparent bg-card shadow-md"
      )}
    >
      {children(handleRef)}
    </li>
  )
}
