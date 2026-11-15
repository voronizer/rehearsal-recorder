// signalsmith-stretch 1.3.2 ships no types: what this service uses of it.
declare module "signalsmith-stretch" {
  /** The node the library makes: on live input once started; `schedule` changes it, now or at a clock time. */
  export type StretchNode = AudioWorkletNode & {
    start(when?: number): Promise<void>
    schedule(change: { output?: number; semitones?: number; active?: boolean }): Promise<void>
    /** Its own delay on live input, in seconds. */
    latency(): Promise<number>
  }
  function SignalsmithStretch(context: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<StretchNode>
  namespace SignalsmithStretch {
    /** Where the sound thread loads the library from; by default a `blob:` made from its own text. */
    let moduleUrl: string | undefined
  }
  export default SignalsmithStretch
}
