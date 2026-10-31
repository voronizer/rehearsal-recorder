import { expect, test } from "vitest"
import kept from "../openapi.json"
import { call } from "./helpers"

// РЭХА's tests check every request against service/openapi.json, so it must
// be what the Worker serves: after a change to a route, run npm run openapi.
test("openapi.json in the repository is what the Worker serves", async () => {
  const res = await call("/api/openapi.json")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(kept)
})
