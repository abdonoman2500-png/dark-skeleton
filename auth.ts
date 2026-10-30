import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

const scrypt = promisify(scryptCallback);
export const COOKIE = "wasl_session";
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, value] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !value || !/^[a-f0-9]{128}$/.test(value)) return false;
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(candidate, Buffer.from(value, "hex"));
}
export function makePublicId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = randomBytes(8);
  return Array.from(random, (n) => chars[n % chars.length]).join("");
}
export function publicUser(user: typeof users.$inferSelect) {
  return { id: user.id, publicId: user.publicId, name: user.name, about: user.about, avatar: user.avatar, language: user.language, theme: user.theme, wallpaper: user.wallpaper, discoverable: user.discoverable, notifications: user.notifications, email: user.email, lastSeenAt: user.lastSeenAt };
}
export function publicProfile(user: typeof users.$inferSelect) {
  return { id: user.id, publicId: user.publicId, name: user.name, about: user.about, avatar: user.avatar, lastSeenAt: user.lastSeenAt };
}
export async function currentUser(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const [row] = await db.select({ user: users, session: sessions }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return row ?? null;
}
export async function createSession(req: NextRequest, userId: string, response: NextResponse) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt, userAgent: (req.headers.get("user-agent") || "Unknown device").slice(0, 250) });
  response.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https", path: "/", expires: expiresAt });
}
export function clearSession(response: NextResponse) { response.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 }); }

const attempts = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  if (attempts.size > 10000) for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) { attempts.set(key, { count: 1, reset: now + windowMs }); return true; }
  entry.count++;
  return entry.count <= limit;
}
export function networkKey(req: NextRequest) { return (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim().slice(0, 100); }
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get("x-forwarded-host") || req.headers.get("host")); } catch { return false; }
}
