import { createEncoder } from "wasm-media-encoders"
import wasm from "wasm-media-encoders/wasm/mp3?url"

/*
  LAME, the MP3 encoder РЭХА's libsndfile uses too, built for the browser
  as WebAssembly by `wasm-media-encoders`. This module is loaded only when a
  mix is made, and the encoder (about 130 KB) comes as a file of its own,
  not inside the pages' script.
*/
export const mp3Encoder = () => createEncoder("audio/mpeg", wasm)
