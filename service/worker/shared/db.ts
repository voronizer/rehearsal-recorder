import { drizzle } from "drizzle-orm/d1"
import type { Bindings } from "./env"
import * as schema from "./schema"

export const database = (env: Bindings) => drizzle(env.DB, { schema })
export type Database = ReturnType<typeof database>
