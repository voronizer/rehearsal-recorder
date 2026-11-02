/**
 * A stretch of sound as a wave of `buckets` numbers: in each slice, the
 * loudest sample of any channel, as РЭХА draws a WAV (audio/waveform.py)
 * and as the take's `.peaks` holds it. `pieces` follow one another; each is
 * one Float32Array per channel.
 */
export function peaksOf(pieces: Float32Array[][], buckets: number): number[] {
  const total = pieces.reduce((n, p) => n + (p[0]?.length ?? 0), 0)
  const out = new Array<number>(buckets).fill(0)
  if (!total) return out
  // Fewer samples than slices: each slice is the sample under it.
  if (total < buckets) {
    const loudest: number[] = []
    for (const p of pieces) for (let k = 0; k < p[0].length; k++) loudest.push(Math.max(...p.map((c) => Math.abs(c[k]))))
    return out.map((_, i) => loudest[Math.floor((i * total) / buckets)])
  }
  let at = 0
  for (const p of pieces) {
    const n = p[0].length
    for (let k = 0; k < n; k++, at++) {
      const slice = Math.floor((at * buckets) / total)
      for (const channel of p) {
        const v = Math.abs(channel[k])
        if (v > out[slice]) out[slice] = v
      }
    }
  }
  return out
}
