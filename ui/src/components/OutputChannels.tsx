import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** "3–4" for a pair, "5 (mono)" for one output on its own. */
function label(channels: number[]) {
  return channels.length === 1 ? `${channels[0]} (mono)` : channels.join("–")
}

/**
 * Which outputs of the playback card the mix comes out of.
 *
 * Pairs the way cards label their stereo outs — 1–2, 3–4, 5–6 — and then
 * each output on its own, for a single monitor or a headphone amp fed from
 * one line. 2–3 is not offered: no card wires a pair that way, and it would
 * double the list for nothing.
 */
export function OutputChannels({
  count,
  value,
  onChange,
}: {
  /** How many outputs the card has. */
  count: number
  value: number[]
  onChange: (channels: number[]) => void
}) {
  const options: number[][] = []
  for (let c = 1; c + 1 <= count; c += 2) options.push([c, c + 1])
  for (let c = 1; c <= count; c++) options.push([c])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm text-muted-foreground">Outputs</span>
      <Select
        value={value.join("-")}
        onValueChange={(v) => onChange(v.split("-").map(Number))}
      >
        <SelectTrigger
          id="output-channels"
          aria-label="Outputs"
          className="w-40"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((channels) => (
            <SelectItem key={channels.join("-")} value={channels.join("-")}>
              {label(channels)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
