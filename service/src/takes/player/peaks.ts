/**
 * A stretch of sound as a wave of `buckets` numbers: in each slice, the
 * loudest sample of any channel, as РЭХА draws a WAV (audio/waveform.py)
 * and as the take's `.peaks` holds it. `pieces` follow one another; each is
 * one Float32Array per channel.
 */
export function peaksOf(pieces: Float32Array[][], buckets: number): number[] {
  const fold = new Fold(
    pieces.reduce((n, p) => n + (p[0]?.length ?? 0), 0),
    buckets
  )
  for (const p of pieces) fold.add(p)
  return fold.peaks
}

/**
 * The same wave, made as the sound is decoded, so only its `buckets`
 * numbers are kept and not the sound: `total` samples are to come, in
 * pieces. A slice the sound never reaches (past a file's end) stays 0.
 */
export class Fold {
  private at = 0
  private readonly out: number[]

  constructor(
    private readonly total: number,
    private readonly buckets: number
  ) {
    this.out = new Array<number>(buckets).fill(0)
  }

  /** The next piece of the stretch, one Float32Array per channel. */
  add(piece: Float32Array[]): void {
    const { total, buckets, out } = this
    const n = piece[0]?.length ?? 0
    for (let k = 0; k < n && this.at < total; k++, this.at++) {
      let v = 0
      for (const channel of piece) {
        const x = Math.abs(channel[k])
        if (x > v) v = x
      }
      if (total >= buckets) {
        const slice = Math.floor((this.at * buckets) / total)
        if (v > out[slice]) out[slice] = v
      } else {
        // Fewer samples than slices: each slice is the sample under it.
        for (let i = Math.floor((this.at * buckets) / total); i < buckets && Math.floor((i * total) / buckets) <= this.at; i++)
          if (Math.floor((i * total) / buckets) === this.at) out[i] = v
      }
    }
  }

  /** The wave so far. */
  get peaks(): number[] {
    return this.out
  }
}
