import { and, eq, gt, inArray, or } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { blocks, conversations, members, messages, pushSubscriptions, receipts, sessions, statuses, users } from "@/db/schema";

export async function membership(conversationId: string, userId: string) {
  const [row] = await db.select({ member: members, conversation: conversations }).from(members).innerJoin(conversations, eq(conversations.id, members.conversationId)).where(and(eq(members.conversationId, conversationId), eq(members.userId, userId))).limit(1);
  return row ?? null;
}
export async function isBlocked(a: string, b: string) {
  const [row] = await db.select({ blockerId: blocks.blockerId }).from(blocks).where(or(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)), and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)))).limit(1);
  return !!row;
}
export async function canWrite(conversationId: string, userId: string) {
  const room = await membership(conversationId, userId);
  if (!room) return false;
  if (room.conversation.type === "direct") {
    const others = await db.select().from(members).where(eq(members.conversationId, conversationId));
    const other = others.find((m) => m.userId !== userId);
    if (!other || await isBlocked(userId, other.userId)) return false;
  }
  return true;
}
export async function visibleStatus(statusId: string, userId: string) {
  const [status] = await db.select().from(statuses).where(eq(statuses.id, statusId)).limit(1);
  if (!status || status.expiresAt <= new Date()) return false;
  if (status.userId === userId) return true;
  if (status.audience !== "contacts" || await isBlocked(userId, status.userId)) return false;
  const mine = await db.select({ id: members.conversationId }).from(members).where(eq(members.userId, userId));
  if (!mine.length) return false;
  const [shared] = await db.select({ id: members.conversationId }).from(members).innerJoin(conversations, eq(conversations.id, members.conversationId)).where(and(eq(members.userId, status.userId), eq(conversations.type, "direct"), inArray(members.conversationId, mine.map((m) => m.id)))).limit(1);
  return !!shared;
}

export function validateFile(file: File, buffer: Buffer): { mime: string; kind: string; filename: string } | null {
  if (!file.size || file.size > 10 * 1024 * 1024 || buffer.length !== file.size) return null;
  const mime = file.type.toLowerCase().split(";")[0];
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString("ascii");
  let valid = false;
  if (mime === "image/jpeg") valid = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  else if (mime === "image/png") valid = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  else if (mime === "image/gif") valid = ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  else if (mime === "image/webp") valid = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  else if (mime === "video/mp4" || mime === "audio/mp4") valid = ascii(4, 8) === "ftyp";
  else if (["video/webm", "audio/webm"].includes(mime)) valid = buffer.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  else if (["audio/ogg", "video/ogg"].includes(mime)) valid = ascii(0, 4) === "OggS";
  else if (["audio/wav", "audio/x-wav"].includes(mime)) valid = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
  else if (mime === "audio/mpeg") valid = ascii(0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  else if (mime === "application/pdf") valid = ascii(0, 5) === "%PDF-";
  else if (mime === "text/plain") valid = !buffer.subarray(0, 2048).includes(0);
  else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") valid = ascii(0, 2) === "PK";
  if (!valid) return null;
  const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
  return { mime, kind, filename: (file.name || "attachment").replace(/[\r\n\x00-\x1f\\/]/g, "_").slice(0, 180) };
}

export async function notifyUsers(userIds: string[], title: string, body: string, url: string) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject || !userIds.length) return;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const subs = await db.select({ subscription: pushSubscriptions, enabled: users.notifications }).from(pushSubscriptions).innerJoin(users, eq(users.id, pushSubscriptions.userId)).innerJoin(sessions, eq(sessions.id, pushSubscriptions.sessionId)).where(and(inArray(pushSubscriptions.userId, userIds), gt(sessions.expiresAt, new Date())));
    await Promise.allSettled(subs.filter(s => s.enabled).map(async ({ subscription }) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title, body, url }), { TTL: 3600 });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      }
    }));
  } catch (error) { console.error("Push configuration error", error); }
}

export async function createMessage(input: { conversationId: string; senderId: string; senderName: string; body: string; kind?: string; attachmentId?: string; replyToId?: string }) {
  if (!(await canWrite(input.conversationId, input.senderId))) return null;
  if (input.replyToId) {
    const [reply] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.id, input.replyToId), eq(messages.conversationId, input.conversationId))).limit(1);
    if (!reply) return null;
  }
  const recipients = await db.select({ userId: members.userId, muted: members.muted }).from(members).where(eq(members.conversationId, input.conversationId));
  const others = recipients.filter(m => m.userId !== input.senderId);
  const [created] = await db.transaction(async tx => {
    const result = await tx.insert(messages).values({ conversationId: input.conversationId, senderId: input.senderId, body: input.body, kind: input.kind || "text", attachmentId: input.attachmentId, replyToId: input.replyToId }).returning();
    if (others.length) await tx.insert(receipts).values(others.map(m => ({ messageId: result[0].id, userId: m.userId })));
    await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
    return result;
  });
  await notifyUsers(others.filter(m => !m.muted).map(m => m.userId), input.senderName, input.kind && input.kind !== "text" ? "أرسل إليك مرفقاً" : input.body.slice(0, 120), `/?chat=${input.conversationId}`);
  return created;
}

export function allowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"));
  } catch { return false; }
}
