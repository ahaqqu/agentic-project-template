import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Minimal hello table — proves D1 + Drizzle wiring. */
export const greetings = sqliteTable("greetings", {
  id: text("id").primaryKey(),
  message: text("message").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});
