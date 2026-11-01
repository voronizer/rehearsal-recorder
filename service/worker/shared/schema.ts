// Every table of the band service, the one place they are described.
// `npx drizzle-kit generate` writes the next migration from what changed.
//
// better-auth's tables come first, as `npx auth@1.7.14 generate` printed
// them for the plugins in use (emailOTP, admin, API Key). A member is a
// `user` row, never deleted: Remove bans it, so their stars and comments
// keep their name.

import { relations, sql } from "drizzle-orm"
import { type AnySQLiteColumn, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apikey = sqliteTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
    enabled: integer("enabled", { mode: "boolean" }).default(true),
    rateLimitEnabled: integer("rate_limit_enabled", {
      mode: "boolean",
    }).default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: integer("last_request", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// The service's own.

export type Track = { position: number; name: string; icon: string | null; files: string[] }
export type Notes = { position: number; name: string; file: string }

export const rehearsal = sqliteTable("rehearsal", {
  uid: text("uid").primaryKey(),
  name: text("name").notNull(),
  /** A calendar day, 2026-10-30, with no time zone. */
  date: text("date").notNull(),
})

/** The band: one row, id 1. */
export const band = sqliteTable("band", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().default(""),
  /** When the picture was put in R2 at band/picture; null with none. */
  pictureAt: text("picture_at"),
})

/**
 * The band's labels for marks, in their order. `colour` is one of РЭХА's
 * eight (labels/match.ts). `was` holds the names a label had before it was
 * renamed here, so marks РЭХА still sends under one of them find it.
 */
export const label = sqliteTable(
  "label",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    colour: text("colour").notNull(),
    position: integer("position").notNull(),
    was: text("was", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  },
  (table) => [uniqueIndex("label_name_nocase").on(sql`${table.name} COLLATE NOCASE`)]
)

/** Where a song stands with the band, in the order Songs groups them. */
export const status = sqliteTable(
  "status",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [uniqueIndex("status_name_nocase").on(sql`${table.name} COLLATE NOCASE`)]
)

export const song = sqliteTable(
  "song",
  {
    id: integer("id").primaryKey(),
    title: text("title").notNull(),
    /** Every song has one; null only for a moment, read as the first status. */
    statusId: integer("status_id").references(() => status.id),
    /** One of the 24 keys, “E minor”, or null. */
    key: text("key"),
    /** Beats per minute as РЭХА keeps it for the song, or null. */
    tempo: real("tempo"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at"),
  },
  // Songs match by title whatever its case.
  (table) => [uniqueIndex("song_title_nocase").on(sql`${table.title} COLLATE NOCASE`)]
)

/** A song's file in R2, at songs/<song id>/<file id>. */
export const songFile = sqliteTable(
  "song_file",
  {
    id: integer("id").primaryKey(),
    songId: integer("song_id")
      .notNull()
      .references(() => song.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "gp", "pdf", "picture" or "other": what pressing it does. */
    kind: text("kind").notNull(),
    type: text("type").notNull(),
    size: integer("size").notNull(),
    memberId: text("member_id").references(() => user.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("song_file_song_idx").on(table.songId)]
)

export const take = sqliteTable(
  "take",
  {
    uid: text("uid").primaryKey(),
    rehearsalUid: text("rehearsal_uid")
      .notNull()
      .references(() => rehearsal.uid),
    number: integer("number").notNull(),
    songId: integer("song_id").references(() => song.id),
    name: text("name").notNull(),
    durationSec: real("duration_sec").notNull(),
    /** The ★ set in РЭХА, which is nobody's star. */
    starredAtRehearsal: integer("starred_at_rehearsal", { mode: "boolean" }).notNull().default(false),
    balance: text("balance", { mode: "json" }).$type<Record<string, number>>().notNull(),
    tracks: text("tracks", { mode: "json" }).$type<Track[]>().notNull(),
    notes: text("notes", { mode: "json" }).$type<Notes[]>().notNull(),
    /** The generation РЭХА sends now; one more for each crop. */
    gen: integer("gen").notNull(),
    /** The generation the band hears, once its MP3s are all up. */
    shownGen: integer("shown_gen"),
    /** The generation whose FLAC files are all up. */
    flacGen: integer("flac_gen"),
    /** What the crops took off the start, waiting for the next shown generation. */
    pendingCut: real("pending_cut").notNull().default(0),
    shownAt: text("shown_at"),
    trashedAt: text("trashed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("take_rehearsal_idx").on(table.rehearsalUid), index("take_song_idx").on(table.songId)]
)

/**
 * Marks and the comments under them. A row with no parent is a mark: a
 * moment of a take with a label and a note, from РЭХА or set here. A row
 * with a parent is a comment under that mark.
 */
export const comment = sqliteTable(
  "comment",
  {
    id: integer("id").primaryKey(),
    takeUid: text("take_uid")
      .notNull()
      .references(() => take.uid, { onDelete: "cascade" }),
    parentId: integer("parent_id").references((): AnySQLiteColumn => comment.id, {
      onDelete: "cascade",
    }),
    /** Null for a mark from РЭХА. */
    memberId: text("member_id").references(() => user.id),
    /** A comment's is its mark's. */
    at: real("at").notNull(),
    /** A mark's note, or a comment's words. */
    text: text("text").notNull(),
    /** A mark's label; null for a comment. */
    labelId: integer("label_id").references(() => label.id),
    fromReha: integer("from_reha", { mode: "boolean" }).notNull().default(false),
    /** A mark's: the place is fixed. */
    closed: integer("closed", { mode: "boolean" }).notNull().default(false),
    /** It was in the part a crop cut off, and stays at 0:00. */
    cutOff: integer("cut_off", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    /** When its writer last changed it; null if never. */
    updatedAt: text("updated_at"),
  },
  (table) => [index("comment_take_idx").on(table.takeUid)]
)

export const star = sqliteTable(
  "star",
  {
    takeUid: text("take_uid")
      .notNull()
      .references(() => take.uid, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => user.id),
  },
  (table) => [primaryKey({ columns: [table.takeUid, table.memberId] })]
)

export const seen = sqliteTable(
  "seen",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => user.id),
    takeUid: text("take_uid")
      .notNull()
      .references(() => take.uid, { onDelete: "cascade" }),
    seenAt: text("seen_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.takeUid] })]
)

/** The band chat's messages that may still take additions. */
export const chat = sqliteTable("chat", {
  id: integer("id").primaryKey(),
  /** "takes" (about a rehearsal), "marks" (a member's on one take) or "comments" (a member's under one mark). */
  kind: text("kind").notNull(),
  about: text("about").notNull(),
  messageId: integer("message_id").notNull(),
  text: text("text").notNull(),
  startedAt: text("started_at").notNull(),
})

/** When the owner was last told of a failure of each route or job. */
export const failureNotice = sqliteTable("failure_notice", {
  what: text("what").primaryKey(),
  toldAt: text("told_at").notNull(),
})
