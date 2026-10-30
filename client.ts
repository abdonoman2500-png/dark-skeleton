export type User = { id: string; publicId: string; name: string; email: string; about: string; avatar: string | null; language: string; theme: string; wallpaper: string; discoverable: boolean; notifications: boolean; lastSeenAt: string };
export type Profile = { id: string; publicId: string; name: string; about: string; avatar: string | null; lastSeenAt?: string; role?: string };
export type Conversation = { id: string; type: string; title: string | null; name: string; avatar: string | null; publicId?: string; otherId?: string; about?: string; online: boolean; typing?: boolean; role: string; muted: boolean; updatedAt: string; lastMessage: { id: string; body: string; kind: string; senderId: string; createdAt: string; deletedAt: string | null } | null; unread: number; members: Profile[]; demoTime?: string; color?: string };
export type Message = { id: string; conversationId: string; senderId: string; body: string; kind: string; attachmentId: string | null; replyToId: string | null; editedAt: string | null; deletedAt: string | null; createdAt: string; sender: { id: string; name: string; publicId?: string; avatar: string | null }; attachment: { id: string; filename: string; mime: string; size: number } | null; reactions: { messageId: string; userId: string; emoji: string }[]; receipt: string; reply: { id: string; body: string; kind: string; senderId: string } | null; demoTime?: string; demoImage?: string };
export type Status = { id: string; userId: string; body: string; color: string; createdAt: string; expiresAt: string; audience: string; person: Profile; views?: number; seen: boolean; attachment: { id: string; mime: string; filename: string } | null };

export async function api<T = Record<string, unknown>>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: options.method || "GET", credentials: "same-origin", headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined, body: options.body !== undefined ? JSON.stringify(options.body) : undefined, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "حدث خطأ، حاول مرة أخرى");
  return data as T;
}
export function upload(path: string, form: FormData, progress?: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("POST", `/api/${path}`); xhr.withCredentials = true;
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress?.(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else { try { reject(new Error(JSON.parse(xhr.responseText).error)); } catch { reject(new Error("تعذر رفع الملف")); } } };
    xhr.onerror = () => reject(new Error("تعذر الاتصال بالخادم")); xhr.send(form);
  });
}

const portraits = {
  sara: "https://images.pexels.com/photos/24551876/pexels-photo-24551876.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=200",
  mohammed: "https://images.pexels.com/photos/5308640/pexels-photo-5308640.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=200",
  nour: "https://images.pexels.com/photos/35367077/pexels-photo-35367077.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=200",
  laila: "https://images.pexels.com/photos/7717254/pexels-photo-7717254.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=200",
  ahmed: "https://images.pexels.com/photos/35681211/pexels-photo-35681211.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=200",
};
export const demoLandscape = "https://images.pexels.com/photos/138903/pexels-photo-138903.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=360&w=620";
export const demoMedia = [demoLandscape, "https://images.pexels.com/photos/40090812/pexels-photo-40090812.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=180&w=180", "https://images.pexels.com/photos/15499497/pexels-photo-15499497.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=180&w=180"];
const baseDate = "2026-04-22T10:30:00.000Z";
const sample = (id: string, name: string, avatar: string | null, body: string, time: string, unread = 0, type = "direct", color?: string): Conversation => ({ id, type, title: type === "group" ? name : null, name, avatar, publicId: id === "sara" ? "SARA7K2M" : "WASL2026", otherId: id, about: id === "sara" ? "الحياة أجمل مع من نحب 🌿" : "مرحباً! أنا أستخدم وَصل.", online: id === "sara", role: "member", muted: false, updatedAt: baseDate, lastMessage: { id: `last-${id}`, body, kind: "text", senderId: id, createdAt: baseDate, deletedAt: null }, unread, members: [], demoTime: time, color });
export const demoConversations: Conversation[] = [
  sample("sara", "سارة أحمد", portraits.sara, "أكيد! متحمسة جداً ✨", "١٠:٣٢ ص", 2),
  sample("friends", "لَمّة الأصدقاء ✨", null, "نور: الصور تجنن! 😍", "٩:٤٥ ص", 4, "group", "peach"),
  sample("mohammed", "محمد العتيبي", portraits.mohammed, "تمام، أشوفك بكرة إن شاء الله", "أمس"),
  sample("nour", "نور خالد", portraits.nour, "شكراً لكِ يا حبيبتي 🤍", "أمس", 1),
  sample("work", "فريق العمل", null, "أحمد: تم إرسال الملفات", "الأحد", 0, "group", "lavender"),
  sample("laila", "ليلى حسن", portraits.laila, "أرسلت لكِ التفاصيل 🌸", "السبت"),
  sample("ahmed", "أحمد محمود", portraits.ahmed, "يسعد مساك! كيف الأمور؟", "الجمعة"),
];
const msg = (id: string, senderId: string, body: string, demoTime: string, extra: Partial<Message> = {}): Message => ({ id, conversationId: "sara", senderId, body, kind: "text", attachmentId: null, replyToId: null, editedAt: null, deletedAt: null, createdAt: baseDate, sender: { id: senderId, name: senderId === "me" ? "أنا" : "سارة أحمد", avatar: senderId === "me" ? null : portraits.sara }, attachment: null, reactions: [], receipt: "read", reply: null, demoTime, ...extra });
export const demoMessages: Message[] = [
  msg("d1", "sara", "صباح الخير! كيف حالك اليوم؟ ☀️", "١٠:٢٤ ص"),
  msg("d2", "me", "صباح النور يا سارة! بخير الحمد لله، وأنتِ؟", "١٠:٢٥ ص"),
  msg("d3", "sara", "الحمد لله تمام 🤍 كنت حابة أشاركك صور الرحلة، كانت من أجمل الأيام!", "١٠:٢٧ ص"),
  msg("d4", "sara", "شوفي هالمنظر! 😍", "١٠:٢٨ ص", { kind: "image", demoImage: demoLandscape }),
  msg("d5", "me", "واااو، المكان يجنّن! لازم نروح له المرة الجاية 🌿", "١٠:٣٠ ص"),
  msg("d6", "sara", "أكيد! متحمسة جداً ✨", "١٠:٣٢ ص"),
];
export const demoMe: User = { id: "me", publicId: "WASL2026", name: "أنت", email: "", about: "مساحة أقرب لمن نحب", avatar: null, language: "ar", theme: "light", wallpaper: "doodles", discoverable: true, notifications: true, lastSeenAt: baseDate };
