import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  publicId: varchar("public_id", { length: 8 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  about: varchar("about", { length: 160 }).notNull().default("مرحباً! أنا أستخدم وَصل."),
  avatar: text("avatar"),
  language: varchar("language", { length: 2 }).notNull().default("ar"),
  theme: varchar("theme", { length: 10 }).notNull().default("light"),
  wallpaper: varchar("wallpaper", { length: 16 }).notNull().default("doodles"),
  discoverable: boolean("discoverable").notNull().default(true),
  notifications: boolean("notifications").notNull().default(true),
  lastSeenAt: time("last_seen_at").notNull().defaultNow(),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  userAgent: varchar("user_agent", { length: 250 }).notNull().default(""),
  createdAt: time("created_at").notNull().defaultNow(),
  lastUsedAt: time("last_used_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const passwordResets = pgTable("password_resets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: time("expires_at").notNull(),
  usedAt: time("used_at"),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: varchar("type", { length: 10 }).notNull().default("direct"),
  directKey: varchar("direct_key", { length: 80 }).unique(),
  title: varchar("title", { length: 100 }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (t) => [index("conversations_updated_idx").on(t.updatedAt)]);

export const members = pgTable("conversation_members", {
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 12 }).notNull().default("member"),
  joinedAt: time("joined_at").notNull().defaultNow(),
  lastReadAt: time("last_read_at").notNull().defaultNow(),
  typingUntil: time("typing_until"),
  muted: boolean("muted").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("members_user_idx").on(t.userId)]);

export const attachments = pgTable("attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  filename: varchar("filename", { length: 180 }).notNull(),
  mime: varchar("mime", { length: 100 }).notNull(),
  size: integer("size").notNull(),
  data: bytes("data").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => [index("attachments_conversation_idx").on(t.conversationId)]);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  body: text("body").notNull().default(""),
  kind: varchar("kind", { length: 12 }).notNull().default("text"),
  attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }),
  replyToId: uuid("reply_to_id"),
  editedAt: time("edited_at"),
  deletedAt: time("deleted_at"),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => [index("messages_conversation_time_idx").on(t.conversationId, t.createdAt)]);

export const receipts = pgTable("message_receipts", {
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deliveredAt: time("delivered_at"),
  readAt: time("read_at"),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId] }), index("receipts_user_idx").on(t.userId)]);

export const reactions = pgTable("message_reactions", {
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: varchar("emoji", { length: 24 }).notNull(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId] })]);

export const blocks = pgTable("blocked_users", {
  blockerId: uuid("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  blockedId: uuid("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })]);

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reporterId: uuid("reporter_id").notNull().references(() => users.id),
  reportedId: uuid("reported_id").notNull().references(() => users.id),
  reason: varchar("reason", { length: 500 }).notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const statuses = pgTable("statuses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: varchar("body", { length: 500 }).notNull().default(""),
  color: varchar("color", { length: 20 }).notNull().default("#147c6d"),
  attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }),
  audience: varchar("audience", { length: 16 }).notNull().default("contacts"),
  createdAt: time("created_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
}, (t) => [index("statuses_expiry_idx").on(t.expiresAt)]);

export const statusViews = pgTable("status_views", {
  statusId: uuid("status_id").notNull().references(() => statuses.id, { onDelete: "cascade" }),
  viewerId: uuid("viewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  viewedAt: time("viewed_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.statusId, t.viewerId] })]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const calls = pgTable("calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  callerId: uuid("caller_id").notNull().references(() => users.id),
  calleeId: uuid("callee_id").notNull().references(() => users.id),
  mode: varchar("mode", { length: 10 }).notNull(),
  state: varchar("state", { length: 16 }).notNull().default("ringing"),
  createdAt: time("created_at").notNull().defaultNow(),
  answeredAt: time("answered_at"),
  endedAt: time("ended_at"),
}, (t) => [index("calls_callee_idx").on(t.calleeId, t.createdAt)]);

export const callSignals = pgTable("call_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  callId: uuid("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  kind: varchar("kind", { length: 16 }).notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, (t) => [index("call_signals_call_idx").on(t.callId, t.createdAt)]);
