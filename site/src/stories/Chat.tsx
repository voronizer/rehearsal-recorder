import type { CSSProperties } from "react"
import type { ChatLine } from "../content/stories"
import { Inline } from "../page/Md"

/**
 * The band arguing, as its chat: each line in a bubble, who says it over
 * it. Alex tells the stories, so his lines are on the right, with no name.
 * `--i` is each line's place in the order they come in, counted on from
 * `from` (the block on the main page brings them in one at a time).
 */
export function Chat({ lines, from = 0 }: { lines: ChatLine[]; from?: number }) {
  return (
    <div className="chat">
      {lines.map((line, k) => (
        <div
          key={k}
          className={`say${line.who === "Me" ? " me" : ""}${k > 0 && lines[k - 1].who === line.who ? " same" : ""}`}
          style={{ "--i": from + k } as CSSProperties}
        >
          <span className="who">{line.who}</span>
          <p>
            <Inline text={line.text} />
          </p>
        </div>
      ))}
    </div>
  )
}
