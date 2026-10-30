import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/db";
import { attachments, blocks, callSignals, calls, conversations, members, messages, passwordResets, pushSubscriptions, reactions, receipts, reports, sessions, statuses, statusViews, users } from "@/db/schema";
import { clearSession, createSession, currentUser, hashPassword, makePublicId, networkKey, publicProfile, publicUser, rateLimit, sameOrigin, sha256, verifyPassword } from "@/lib/auth";
import { allowedPushEndpoint, canWrite, createMessage, isBlocked, membership, notifyUsers, validateFile, visibleStatus } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const error = (message: string, status = 400) => json({ error: message }, status);
const uuid = z.string().uuid();
const userId = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,8}$/);
const email = z.string().trim().email().max(254).transform(s => s.toLowerCase());
const password = z.string().min(8).max(128);
const textBody = z.string().trim().min(1).max(4000);
const jsonBody = async (req: NextRequest) => {
  if (Number(req.headers.get("content-length") || 0) > 100_000) throw new Error("body_too_large");
  return req.json();
};
const iceServers = () => {
  const ice: { urls: string; username?: string; credential?: string }[] = [{ urls: process.env.STUN_URL || "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) ice.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD });
  return ice;
};

async function handler(req: NextRequest, context: Context) {
  const parts = (await context.params).path;
  const path = parts.join("/");
  const method = req.method;
  const url = req.nextUrl;
  if (method !== "GET" && !sameOrigin(req)) return error("طلب غير مسموح من هذا المصدر", 403);

  if (path === "auth/register" && method === "POST") {
    if (!rateLimit(`register:${networkKey(req)}`, 8, 600_000)) return error("محاولات كثيرة، حاول لاحقاً", 429);
    const input = z.object({ name: z.string().trim().min(2).max(80), email, password }).parse(await jsonBody(req));
    const hash = await hashPassword(input.password);
    for (let n = 0; n < 6; n++) {
      const [created] = await db.insert(users).values({ name: input.name, email: input.email, passwordHash: hash, publicId: makePublicId() }).onConflictDoNothing().returning();
      if (created) { const response = json({ user: publicUser(created) }, 201); await createSession(req, created.id, response); return response; }
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
      if (existing) return error("هذا البريد مسجّل بالفعل", 409);
    }
    return error("تعذر إنشاء الحساب، حاول مرة أخرى", 500);
  }
  if (path === "auth/login" && method === "POST") {
    if (!rateLimit(`login:${networkKey(req)}`, 15, 600_000)) return error("محاولات كثيرة، حاول لاحقاً", 429);
    const input = z.object({ email, password: z.string().max(128) }).parse(await jsonBody(req));
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user) { await hashPassword(input.password || "invalid"); return error("البريد الإلكتروني أو كلمة المرور غير صحيحة", 401); }
    if (!(await verifyPassword(input.password, user.passwordHash))) return error("البريد الإلكتروني أو كلمة المرور غير صحيحة", 401);
    const response = json({ user: publicUser(user) }); await createSession(req, user.id, response); return response;
  }
  if (path === "auth/forgot" && method === "POST") {
    if (!rateLimit(`forgot:${networkKey(req)}`, 5, 600_000)) return error("محاولات كثيرة، حاول لاحقاً", 429);
    const input = z.object({ email }).parse(await jsonBody(req));
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM || !process.env.APP_URL) return error("استعادة كلمة المرور غير مهيأة على هذا الخادم", 503);
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (user) {
      const token = randomBytes(32).toString("base64url");
      await db.insert(passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
      const link = `${process.env.APP_URL.replace(/\/$/, "")}/?reset=${encodeURIComponent(token)}`;
      try { const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: [user.email], subject: "إعادة تعيين كلمة مرور وَصل", text: `استخدم الرابط خلال 30 دقيقة لإعادة تعيين كلمة المرور: ${link}` }) }); if (!response.ok) console.error("Password recovery mail failed", response.status); } catch (e) { console.error("Password recovery mail failed", e); }
    }
    return json({ ok: true, message: "إذا كان البريد مسجلاً، ستصلك رسالة لاستعادة كلمة المرور." });
  }
  if (path === "auth/reset" && method === "POST") {
    if (!rateLimit(`reset:${networkKey(req)}`, 8, 600_000)) return error("محاولات كثيرة، حاول لاحقاً", 429);
    const input = z.object({ token: z.string().min(20).max(100), password }).parse(await jsonBody(req));
    const hash = await hashPassword(input.password);
    const changed = await db.transaction(async tx => {
      const [reset] = await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.tokenHash, sha256(input.token)), gt(passwordResets.expiresAt, new Date()), isNull(passwordResets.usedAt))).returning();
      if (!reset) return false;
      await tx.update(users).set({ passwordHash: hash }).where(eq(users.id, reset.userId)); await tx.delete(sessions).where(eq(sessions.userId, reset.userId)); return true;
    });
    return changed ? json({ ok: true }) : error("الرابط غير صالح أو انتهت صلاحيته", 400);
  }
  if (path === "auth/me" && method === "GET") {
    const auth = await currentUser(req); if (!auth) return json({ user: null });
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, auth.user.id)); return json({ user: publicUser(auth.user) });
  }
  const auth = await currentUser(req);
  if (!auth) return error("يرجى تسجيل الدخول أولاً", 401);
  const user = auth.user;
  if (path === "auth/logout" && method === "POST") {
    let endpoint: string | undefined; try { const data = await jsonBody(req); endpoint = typeof data.endpoint === "string" ? data.endpoint : undefined; } catch { /* optional */ }
    if (endpoint) await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
    await db.delete(sessions).where(eq(sessions.id, auth.session.id)); const response = json({ ok: true }); clearSession(response); return response;
  }
  if (path === "profile" && method === "PATCH") {
    const input = z.object({ name: z.string().trim().min(2).max(80).optional(), about: z.string().trim().max(160).optional(), language: z.enum(["ar", "en"]).optional(), theme: z.enum(["light", "dark"]).optional(), wallpaper: z.enum(["doodles", "plain"]).optional(), discoverable: z.boolean().optional(), notifications: z.boolean().optional() }).parse(await jsonBody(req));
    const [updated] = await db.update(users).set(input).where(eq(users.id, user.id)).returning(); return json({ user: publicUser(updated) });
  }
  if (path === "storage" && method === "GET") {
    const [usage] = await db.select({ bytes: sql<string>`coalesce(sum(${attachments.size}), 0)::text`, count: count() }).from(attachments).where(eq(attachments.ownerId, user.id));
    const files = await db.select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime, size: attachments.size, createdAt: attachments.createdAt }).from(attachments).where(eq(attachments.ownerId, user.id)).orderBy(desc(attachments.createdAt)).limit(50);
    return json({ bytes: Number(usage.bytes), count: usage.count, files });
  }
  if (parts[0] === "storage" && parts.length === 2 && method === "DELETE") {
    const id = uuid.parse(parts[1]);
    const [file] = await db.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerId, user.id))).limit(1);
    if (!file) return error("الملف غير موجود", 404);
    await db.transaction(async tx => {
      await tx.update(messages).set({ attachmentId: null, kind: "text", body: user.language === "en" ? "Attachment removed" : "تم حذف المرفق" }).where(and(eq(messages.attachmentId, id), eq(messages.senderId, user.id)));
      await tx.delete(statuses).where(and(eq(statuses.attachmentId, id), eq(statuses.userId, user.id), eq(statuses.body, "")));
      await tx.update(statuses).set({ attachmentId: null }).where(and(eq(statuses.attachmentId, id), eq(statuses.userId, user.id)));
      await tx.delete(attachments).where(and(eq(attachments.id, id), eq(attachments.ownerId, user.id)));
    });
    return json({ ok: true });
  }
  if (path === "security/password" && method === "POST") {
    if (!rateLimit(`password:${user.id}`, 8, 600_000)) return error("محاولات كثيرة، حاول لاحقاً", 429);
    const input = z.object({ current: z.string().max(128), password }).parse(await jsonBody(req));
    if (!(await verifyPassword(input.current, user.passwordHash))) return error("كلمة المرور الحالية غير صحيحة", 400);
    await db.transaction(async tx => { await tx.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, user.id)); await tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, auth.session.id))); }); return json({ ok: true });
  }
  if (path === "sessions" && method === "GET") {
    const list = await db.select({ id: sessions.id, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt, expiresAt: sessions.expiresAt }).from(sessions).where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date()))).orderBy(desc(sessions.createdAt));
    return json({ sessions: list.map(s => ({ ...s, current: s.id === auth.session.id })) });
  }
  if (parts[0] === "sessions" && parts.length === 2 && method === "DELETE") {
    const id = uuid.parse(parts[1]); if (id === auth.session.id) return error("استخدم تسجيل الخروج للجهاز الحالي");
    await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, user.id))); return json({ ok: true });
  }
  if (path === "users/search" && method === "GET") {
    if (!rateLimit(`search:${user.id}`, 40, 60_000)) return error("محاولات كثيرة، حاول لاحقاً", 429);
    const id = userId.parse(url.searchParams.get("id"));
    const [target] = await db.select().from(users).where(and(eq(users.publicId, id), eq(users.discoverable, true))).limit(1);
    if (!target || target.id === user.id || await isBlocked(user.id, target.id)) return error("لم نعثر على مستخدم بهذا المعرّف", 404); return json({ user: publicProfile(target) });
  }
  if (path === "blocks" && method === "GET") {
    const list = await db.select({ profile: users }).from(blocks).innerJoin(users, eq(users.id, blocks.blockedId)).where(eq(blocks.blockerId, user.id)); return json({ users: list.map(x => publicProfile(x.profile)) });
  }
  if (path === "blocks" && method === "POST") {
    const input = z.object({ userId: uuid }).parse(await jsonBody(req)); if (input.userId === user.id) return error("لا يمكنك حظر نفسك");
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1); if (!target) return error("المستخدم غير موجود", 404);
    await db.insert(blocks).values({ blockerId: user.id, blockedId: input.userId }).onConflictDoNothing(); return json({ ok: true });
  }
  if (parts[0] === "blocks" && parts.length === 2 && method === "DELETE") { await db.delete(blocks).where(and(eq(blocks.blockerId, user.id), eq(blocks.blockedId, uuid.parse(parts[1])))); return json({ ok: true }); }
  if (path === "reports" && method === "POST") {
    const input = z.object({ userId: uuid, reason: z.string().trim().min(3).max(500) }).parse(await jsonBody(req));
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target || target.id === user.id) return error("المستخدم غير موجود", 404); await db.insert(reports).values({ reporterId: user.id, reportedId: input.userId, reason: input.reason }); return json({ ok: true });
  }
  if (path === "conversations" && method === "GET") {
    const now = new Date(); await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id)); await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, auth.session.id));
    await db.update(receipts).set({ deliveredAt: now }).where(and(eq(receipts.userId, user.id), isNull(receipts.deliveredAt)));
    const rooms = await db.select({ conversation: conversations, member: members }).from(members).innerJoin(conversations, eq(members.conversationId, conversations.id)).where(eq(members.userId, user.id)).orderBy(desc(conversations.updatedAt));
    const list = await Promise.all(rooms.map(async ({ conversation: room, member }) => {
      const people = await db.select({ user: users, member: members }).from(members).innerJoin(users, eq(members.userId, users.id)).where(eq(members.conversationId, room.id));
      const other = people.find(p => p.user.id !== user.id);
      const [last] = await db.select({ id: messages.id, body: messages.body, kind: messages.kind, senderId: messages.senderId, createdAt: messages.createdAt, deletedAt: messages.deletedAt }).from(messages).where(eq(messages.conversationId, room.id)).orderBy(desc(messages.createdAt)).limit(1);
      const [unread] = await db.select({ value: count() }).from(receipts).innerJoin(messages, eq(receipts.messageId, messages.id)).where(and(eq(receipts.userId, user.id), eq(messages.conversationId, room.id), isNull(receipts.readAt), isNull(messages.deletedAt)));
      return { id: room.id, type: room.type, title: room.title, name: room.type === "group" ? room.title : (other?.user.name || "مستخدم"), avatar: room.type === "direct" ? other?.user.avatar : null, publicId: other?.user.publicId, otherId: other?.user.id, about: other?.user.about, online: !!other && Date.now() - other.user.lastSeenAt.getTime() < 60_000, typing: people.some(p => p.user.id !== user.id && p.member.typingUntil && p.member.typingUntil > now), role: member.role, muted: member.muted, updatedAt: room.updatedAt, lastMessage: last || null, unread: unread?.value || 0, members: people.map(p => ({ ...publicProfile(p.user), role: p.member.role })) };
    })); return json({ conversations: list });
  }
  if (path === "conversations/direct" && method === "POST") {
    const input = z.object({ publicId: userId }).parse(await jsonBody(req));
    const [target] = await db.select().from(users).where(and(eq(users.publicId, input.publicId), eq(users.discoverable, true))).limit(1);
    if (!target || target.id === user.id || await isBlocked(user.id, target.id)) return error("لم نعثر على مستخدم متاح بهذا المعرّف", 404);
    const key = [user.id, target.id].sort().join(":");
    const room = await db.transaction(async tx => {
      const [created] = await tx.insert(conversations).values({ type: "direct", directKey: key, createdBy: user.id }).onConflictDoNothing({ target: conversations.directKey }).returning();
      const [existing] = created ? [created] : await tx.select().from(conversations).where(eq(conversations.directKey, key)).limit(1);
      await tx.insert(members).values([{ conversationId: existing.id, userId: user.id }, { conversationId: existing.id, userId: target.id }]).onConflictDoNothing(); return existing;
    }); return json({ id: room.id });
  }
  if (path === "conversations/group" && method === "POST") {
    const input = z.object({ title: z.string().trim().min(2).max(100), publicIds: z.array(userId).min(1).max(20) }).parse(await jsonBody(req));
    const ids = [...new Set(input.publicIds)].filter(id => id !== user.publicId); if (!ids.length) return error("أضف عضواً واحداً على الأقل");
    const people = await db.select().from(users).where(and(inArray(users.publicId, ids), eq(users.discoverable, true)));
    if (people.length !== ids.length || (await Promise.all(people.map(p => isBlocked(user.id, p.id)))).some(Boolean)) return error("تعذر إضافة أحد المستخدمين، تحقق من المعرّفات");
    const room = await db.transaction(async tx => { const [created] = await tx.insert(conversations).values({ type: "group", title: input.title, createdBy: user.id }).returning(); await tx.insert(members).values([{ conversationId: created.id, userId: user.id, role: "admin" }, ...people.map(p => ({ conversationId: created.id, userId: p.id, role: "member" }))]); return created; }); return json({ id: room.id }, 201);
  }
  if (parts[0] === "conversations" && parts.length >= 3) {
    const roomId = uuid.parse(parts[1]); const room = await membership(roomId, user.id); if (!room) return error("المحادثة غير متاحة", 404);
    if (parts[2] === "typing" && method === "POST") { await db.update(members).set({ typingUntil: new Date(Date.now() + 6000) }).where(and(eq(members.conversationId, roomId), eq(members.userId, user.id))); return json({ ok: true }); }
    if (parts[2] === "mute" && method === "POST") { const input = z.object({ muted: z.boolean() }).parse(await jsonBody(req)); await db.update(members).set({ muted: input.muted }).where(and(eq(members.conversationId, roomId), eq(members.userId, user.id))); return json({ ok: true }); }
    if (parts[2] === "members" && room.conversation.type === "group") {
      if (room.member.role !== "admin") return error("هذه العملية للمشرفين فقط", 403);
      if (parts.length === 3 && method === "POST") {
        const input = z.object({ publicId: userId }).parse(await jsonBody(req)); const [target] = await db.select().from(users).where(and(eq(users.publicId, input.publicId), eq(users.discoverable, true))).limit(1);
        if (!target) return error("المستخدم غير متاح", 404); const existing = await db.select().from(members).where(eq(members.conversationId, roomId));
        if (existing.length >= 50) return error("المجموعة ممتلئة"); if ((await Promise.all(existing.map(m => isBlocked(target.id, m.userId)))).some(Boolean)) return error("تعذر إضافة هذا المستخدم", 403);
        await db.insert(members).values({ conversationId: roomId, userId: target.id }).onConflictDoNothing(); return json({ ok: true });
      }
      if (parts.length === 4 && method === "DELETE") { const targetId = uuid.parse(parts[3]); if (targetId === user.id) return error("لا يمكن إزالة المشرف الحالي"); await db.delete(members).where(and(eq(members.conversationId, roomId), eq(members.userId, targetId))); return json({ ok: true }); }
      if (parts.length === 4 && method === "PATCH") { const targetId = uuid.parse(parts[3]); const input = z.object({ role: z.enum(["admin", "member"]) }).parse(await jsonBody(req)); if (targetId === user.id && input.role === "member") return error("لا يمكن تغيير دور المشرف الحالي"); await db.update(members).set({ role: input.role }).where(and(eq(members.conversationId, roomId), eq(members.userId, targetId))); return json({ ok: true }); }
    }
  }
  if (path === "messages" && method === "GET") {
    const roomId = uuid.parse(url.searchParams.get("conversationId")); if (!(await membership(roomId, user.id))) return error("المحادثة غير متاحة", 404);
    const before = url.searchParams.get("before"); const date = before ? new Date(before) : null; if (date && Number.isNaN(date.getTime())) return error("تاريخ غير صالح");
    const rows = await db.select({ message: messages, sender: users }).from(messages).innerJoin(users, eq(messages.senderId, users.id)).where(and(eq(messages.conversationId, roomId), date ? lt(messages.createdAt, date) : undefined)).orderBy(desc(messages.createdAt)).limit(40);
    const ids = rows.map(r => r.message.id); const now = new Date();
    if (ids.length) await db.update(receipts).set({ deliveredAt: now, readAt: now }).where(and(eq(receipts.userId, user.id), inArray(receipts.messageId, ids), isNull(receipts.readAt)));
    if (!date) await db.update(members).set({ lastReadAt: now }).where(and(eq(members.conversationId, roomId), eq(members.userId, user.id)));
    const [allReactions, allReceipts, allFiles] = ids.length ? await Promise.all([
      db.select().from(reactions).where(inArray(reactions.messageId, ids)), db.select().from(receipts).where(inArray(receipts.messageId, ids)),
      db.select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime, size: attachments.size }).from(attachments).where(inArray(attachments.id, rows.map(r => r.message.attachmentId).filter((id): id is string => !!id).concat(["00000000-0000-0000-0000-000000000000"])))
    ]) : [[], [], []];
    const replyIds = rows.map(r => r.message.replyToId).filter((id): id is string => !!id);
    const replies = replyIds.length ? await db.select({ id: messages.id, body: messages.body, kind: messages.kind, senderId: messages.senderId }).from(messages).where(and(eq(messages.conversationId, roomId), inArray(messages.id, replyIds))) : [];
    const result = rows.reverse().map(({ message: m, sender }) => { const rs = allReceipts.filter(r => r.messageId === m.id); return { ...m, sender: { id: sender.id, name: sender.name, publicId: sender.publicId, avatar: sender.avatar }, attachment: allFiles.find(f => f.id === m.attachmentId) || null, reactions: allReactions.filter(r => r.messageId === m.id), receipt: rs.length && rs.every(r => r.readAt) ? "read" : rs.length && rs.every(r => r.deliveredAt) ? "delivered" : "sent", reply: replies.find(r => r.id === m.replyToId) || null }; });
    return json({ messages: result, hasMore: rows.length === 40 });
  }
  if (path === "messages" && method === "POST") {
    if (!rateLimit(`message:${user.id}`, 120, 60_000)) return error("رسائل كثيرة، حاول لاحقاً", 429);
    const input = z.object({ conversationId: uuid, body: textBody, replyToId: uuid.optional() }).parse(await jsonBody(req)); const created = await createMessage({ ...input, senderId: user.id, senderName: user.name }); return created ? json({ id: created.id }, 201) : error("لا يمكنك الإرسال في هذه المحادثة", 403);
  }
  if (parts[0] === "messages" && parts.length >= 2) {
    const id = uuid.parse(parts[1]); const [message] = await db.select().from(messages).where(eq(messages.id, id)).limit(1); if (!message || !(await membership(message.conversationId, user.id))) return error("الرسالة غير متاحة", 404);
    if (parts.length === 3 && parts[2] === "reaction" && method === "POST") {
      if (message.deletedAt || !(await canWrite(message.conversationId, user.id))) return error("لا يمكن إضافة تفاعل", 403);
      const input = z.object({ emoji: z.string().max(24) }).parse(await jsonBody(req)); if (!input.emoji) await db.delete(reactions).where(and(eq(reactions.messageId, id), eq(reactions.userId, user.id))); else await db.insert(reactions).values({ messageId: id, userId: user.id, emoji: input.emoji }).onConflictDoUpdate({ target: [reactions.messageId, reactions.userId], set: { emoji: input.emoji } }); return json({ ok: true });
    }
    if (message.senderId !== user.id || message.deletedAt) return error("غير مسموح بتعديل هذه الرسالة", 403);
    if (parts.length === 2 && method === "PATCH") { if (message.kind !== "text") return error("يمكن تعديل الرسائل النصية فقط"); const input = z.object({ body: textBody }).parse(await jsonBody(req)); await db.update(messages).set({ body: input.body, editedAt: new Date() }).where(eq(messages.id, id)); return json({ ok: true }); }
    if (parts.length === 2 && method === "DELETE") {
      await db.transaction(async tx => {
        await tx.update(messages).set({ body: "", deletedAt: new Date(), attachmentId: null }).where(eq(messages.id, id));
        await tx.delete(reactions).where(eq(reactions.messageId, id));
        if (message.attachmentId) await tx.delete(attachments).where(and(eq(attachments.id, message.attachmentId), eq(attachments.ownerId, user.id)));
      });
      return json({ ok: true });
    }
  }
  if (path === "upload" && method === "POST") {
    if (!rateLimit(`upload:${user.id}`, 25, 60_000)) return error("عمليات رفع كثيرة، حاول لاحقاً", 429);
    if (Number(req.headers.get("content-length") || 0) > 11 * 1024 * 1024) return error("الحد الأقصى للملف 10 ميغابايت", 413);
    const form = await req.formData(); const roomId = uuid.parse(form.get("conversationId")); const file = form.get("file");
    if (!(file instanceof File) || !(await canWrite(roomId, user.id))) return error("الملف أو المحادثة غير متاحة", 403);
    if (file.size > 10 * 1024 * 1024) return error("الحد الأقصى للملف 10 ميغابايت"); const buffer = Buffer.from(await file.arrayBuffer()); const valid = validateFile(file, buffer); if (!valid) return error("نوع الملف غير مدعوم أو محتواه غير صالح");
    const [uploaded] = await db.insert(attachments).values({ conversationId: roomId, ownerId: user.id, filename: valid.filename, mime: valid.mime, size: buffer.length, data: buffer }).returning({ id: attachments.id });
    const created = await createMessage({ conversationId: roomId, senderId: user.id, senderName: user.name, body: String(form.get("caption") || "").slice(0, 1000), kind: valid.kind, attachmentId: uploaded.id });
    if (!created) { await db.delete(attachments).where(eq(attachments.id, uploaded.id)); return error("لا يمكنك الإرسال هنا", 403); } return json({ id: created.id }, 201);
  }
  if (parts[0] === "files" && parts.length === 2 && method === "GET") {
    const id = uuid.parse(parts[1]); const [file] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1); if (!file) return error("الملف غير موجود", 404);
    let permitted = false;
    if (file.conversationId && await membership(file.conversationId, user.id)) { const [linked] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.attachmentId, id), isNull(messages.deletedAt))).limit(1); permitted = !!linked; }
    else { const [status] = await db.select({ id: statuses.id }).from(statuses).where(eq(statuses.attachmentId, id)).limit(1); permitted = !!status && await visibleStatus(status.id, user.id); }
    if (!permitted) return error("الملف غير متاح", 404); const inline = file.mime.startsWith("image/") || file.mime.startsWith("video/") || file.mime.startsWith("audio/");
    return new NextResponse(new Uint8Array(file.data), { headers: { "Content-Type": file.mime, "Content-Length": String(file.size), "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" } });
  }
  if (path === "status" && method === "GET") {
    const all = await db.select({ status: statuses, person: users }).from(statuses).innerJoin(users, eq(statuses.userId, users.id)).where(gt(statuses.expiresAt, new Date())).orderBy(desc(statuses.createdAt)).limit(100);
    const allowed = await Promise.all(all.map(async row => {
      if (!(await visibleStatus(row.status.id, user.id))) return null;
      const [views] = await db.select({ value: count() }).from(statusViews).where(eq(statusViews.statusId, row.status.id)); const [seen] = await db.select({ id: statusViews.viewerId }).from(statusViews).where(and(eq(statusViews.statusId, row.status.id), eq(statusViews.viewerId, user.id))).limit(1);
      const [file] = row.status.attachmentId ? await db.select({ id: attachments.id, mime: attachments.mime, filename: attachments.filename }).from(attachments).where(eq(attachments.id, row.status.attachmentId)).limit(1) : [];
      return { ...row.status, person: publicProfile(row.person), views: row.status.userId === user.id ? views.value : undefined, seen: !!seen, attachment: file || null };
    })); return json({ statuses: allowed.filter(Boolean) });
  }
  if (path === "status" && method === "POST") {
    if (!rateLimit(`status:${user.id}`, 15, 60_000)) return error("محاولات كثيرة، حاول لاحقاً", 429);
    let body = "", color = "#147c6d", audience = "contacts", file: File | null = null;
    if (req.headers.get("content-type")?.includes("multipart/form-data")) { if (Number(req.headers.get("content-length") || 0) > 11 * 1024 * 1024) return error("الحد الأقصى للملف 10 ميغابايت", 413); const form = await req.formData(); body = String(form.get("body") || "").trim(); color = String(form.get("color") || color); audience = String(form.get("audience") || audience); const f = form.get("file"); if (f instanceof File) file = f; }
    else { const input = z.object({ body: z.string().trim().max(500), color: z.string().optional(), audience: z.enum(["contacts", "private"]).optional() }).parse(await jsonBody(req)); body = input.body; color = input.color || color; audience = input.audience || audience; }
    if (body.length > 500 || (!body && !file) || !/^#[0-9a-fA-F]{6}$/.test(color) || !["contacts", "private"].includes(audience)) return error("تحقق من الحالة");
    let attachmentId: string | undefined;
    if (file) { if (file.size > 10 * 1024 * 1024) return error("الحد الأقصى للملف 10 ميغابايت"); const buffer = Buffer.from(await file.arrayBuffer()); const valid = validateFile(file, buffer); if (!valid || !["image", "video"].includes(valid.kind)) return error("تدعم الحالة الصور والفيديو فقط"); const [created] = await db.insert(attachments).values({ ownerId: user.id, filename: valid.filename, mime: valid.mime, size: buffer.length, data: buffer }).returning({ id: attachments.id }); attachmentId = created.id; }
    const [status] = await db.insert(statuses).values({ userId: user.id, body, color, audience, attachmentId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }).returning(); return json({ id: status.id }, 201);
  }
  if (parts[0] === "status" && parts.length >= 2) {
    const id = uuid.parse(parts[1]); if (!(await visibleStatus(id, user.id))) return error("الحالة غير متاحة", 404);
    if (parts[2] === "view" && method === "POST") { await db.insert(statusViews).values({ statusId: id, viewerId: user.id }).onConflictDoNothing(); return json({ ok: true }); }
    if (parts.length === 2 && method === "DELETE") { await db.delete(statuses).where(and(eq(statuses.id, id), eq(statuses.userId, user.id))); return json({ ok: true }); }
  }
  if (path === "push/key" && method === "GET") return json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  if (path === "push" && method === "POST") {
    const input = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(20).max(256), auth: z.string().min(10).max(256) }) }).parse(await jsonBody(req)); if (!allowedPushEndpoint(input.endpoint)) return error("خادم الإشعارات غير مدعوم");
    await db.insert(pushSubscriptions).values({ userId: user.id, sessionId: auth.session.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, sessionId: auth.session.id, p256dh: input.keys.p256dh, auth: input.keys.auth } }); return json({ ok: true });
  }
  if (path === "push" && method === "DELETE") { const input = z.object({ endpoint: z.string().max(2000) }).parse(await jsonBody(req)); await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, input.endpoint))); return json({ ok: true }); }
  if (path === "calls" && method === "GET") {
    const incoming = await db.select({ call: calls, caller: users }).from(calls).innerJoin(users, eq(calls.callerId, users.id)).where(and(eq(calls.calleeId, user.id), eq(calls.state, "ringing"), gt(calls.createdAt, new Date(Date.now() - 90_000)))).orderBy(desc(calls.createdAt)).limit(1);
    return json({ incoming: incoming.length ? { ...incoming[0].call, caller: publicProfile(incoming[0].caller) } : null, iceServers: iceServers() });
  }
  if (path === "calls/history" && method === "GET") {
    const list = await db.select().from(calls).where(or(eq(calls.callerId, user.id), eq(calls.calleeId, user.id))).orderBy(desc(calls.createdAt)).limit(50);
    const otherIds = [...new Set(list.map(item => item.callerId === user.id ? item.calleeId : item.callerId))];
    const people = otherIds.length ? await db.select().from(users).where(inArray(users.id, otherIds)) : [];
    return json({ calls: list.map(item => { const person = people.find(p => p.id === (item.callerId === user.id ? item.calleeId : item.callerId)); return { ...item, person: person ? publicProfile(person) : null }; }) });
  }
  if (path === "calls" && method === "POST") {
    if (!rateLimit(`call:${user.id}`, 20, 60_000)) return error("محاولات كثيرة، حاول لاحقاً", 429);
    const input = z.object({ conversationId: uuid, mode: z.enum(["audio", "video"]) }).parse(await jsonBody(req)); const room = await membership(input.conversationId, user.id);
    if (!room || room.conversation.type !== "direct" || !(await canWrite(input.conversationId, user.id))) return error("المكالمة غير متاحة", 403);
    const people = await db.select().from(members).where(eq(members.conversationId, input.conversationId)); const other = people.find(p => p.userId !== user.id); if (!other) return error("المستخدم غير متاح", 404);
    const [created] = await db.insert(calls).values({ conversationId: input.conversationId, callerId: user.id, calleeId: other.userId, mode: input.mode }).returning(); await notifyUsers([other.userId], "مكالمة واردة", `${user.name} يتصل بك`, `/?chat=${input.conversationId}`); return json({ call: created, iceServers: iceServers() }, 201);
  }
  if (parts[0] === "calls" && parts.length >= 2) {
    const id = uuid.parse(parts[1]); const [call] = await db.select().from(calls).where(and(eq(calls.id, id), or(eq(calls.callerId, user.id), eq(calls.calleeId, user.id)))).limit(1);
    if (!call || !(await membership(call.conversationId, user.id))) return error("المكالمة غير متاحة", 404);
    if (parts.length === 2 && method === "GET") { const signals = await db.select().from(callSignals).where(and(eq(callSignals.callId, id), ne(callSignals.senderId, user.id))).orderBy(asc(callSignals.createdAt)); return json({ call, signals, iceServers: iceServers() }); }
    if (parts.length === 2 && method === "PATCH") {
      const input = z.object({ action: z.enum(["accept", "reject", "end"]) }).parse(await jsonBody(req));
      if ((input.action === "accept" || input.action === "reject") && (call.calleeId !== user.id || call.state !== "ringing")) return error("لا يمكن تغيير حالة المكالمة", 403);
      await db.update(calls).set(input.action === "accept" ? { state: "active", answeredAt: new Date() } : { state: input.action === "reject" ? "rejected" : "ended", endedAt: new Date() }).where(eq(calls.id, id)); return json({ ok: true });
    }
    if (parts.length === 3 && parts[2] === "signal" && method === "POST") {
      if (!rateLimit(`signal:${user.id}`, 300, 60_000)) return error("إشارات كثيرة، حاول لاحقاً", 429);
      if (!["ringing", "active"].includes(call.state) || !(await canWrite(call.conversationId, user.id))) return error("انتهت المكالمة", 403);
      const input = z.object({ kind: z.enum(["offer", "answer", "candidate"]), payload: z.record(z.string(), z.unknown()) }).parse(await jsonBody(req)); if (JSON.stringify(input.payload).length > 50_000) return error("إشارة كبيرة جداً"); await db.insert(callSignals).values({ callId: id, senderId: user.id, kind: input.kind, payload: input.payload }); return json({ ok: true });
    }
  }
  return error("الطلب غير موجود", 404);
}
async function safe(req: NextRequest, ctx: Context) {
  try { return await handler(req, ctx); } catch (e) {
    if (e instanceof ZodError || e instanceof SyntaxError) return error("يرجى التحقق من البيانات المدخلة", 400);
    if (e instanceof Error && e.message === "body_too_large") return error("حجم الطلب كبير جداً", 413);
    console.error("API error", e); return error("حدث خطأ غير متوقع، حاول مجدداً", 500);
  }
}
export const GET = safe;
export const POST = safe;
export const PATCH = safe;
export const DELETE = safe;
