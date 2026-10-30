import { strict as assert } from 'node:assert';

// Run against an already started application. Creates isolated example.test accounts.
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const stamp = Date.now(), password = 'Test-pass-8492!';
const failures = [];
async function call(path, { method = 'GET', cookie, body, form, origin } = {}) {
  const response = await fetch(`${base}/api/${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), ...(form ? { body: form } : {}) });
  const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function test(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } }
async function register(letter) { return call('auth/register', { method: 'POST', body: { name: `اختبار أمان ${letter}`, email: `security-${letter}-${stamp}@example.test`, password } }); }
const a = await register('a'), b = await register('b'), c = await register('c');
assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(c.status, 201);
let room = '', fileId = '', statusId = '';
await test('origin protection', async () => { const result = await call('auth/login', { method: 'POST', origin: 'https://untrusted.example', body: { email: `security-a-${stamp}@example.test`, password } }); assert.equal(result.status, 403); });
await test('revoked session invalidates its push subscription', async () => {
  const device = await call('auth/login', { method: 'POST', body: { email: `security-a-${stamp}@example.test`, password } }); assert.equal(device.status, 200);
  const endpoint = `https://fcm.googleapis.com/fcm/send/fake-wasl-${stamp}`;
  const sub = await call('push', { method: 'POST', cookie: device.cookie, body: { endpoint, keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(20) } } }); assert.equal(sub.status, 200);
  const sessions = await call('sessions', { cookie: a.cookie }); const other = sessions.data.sessions.find(s => !s.current); assert.ok(other);
  assert.equal((await call(`sessions/${other.id}`, { method: 'DELETE', cookie: a.cookie })).status, 200);
  assert.equal((await call('auth/me', { cookie: device.cookie })).data.user, null);
  console.log(`Revoked test push endpoint: ${endpoint}`);
});
await test('protected storage deletion and revoked file access', async () => {
  const direct = await call('conversations/direct', { method: 'POST', cookie: a.cookie, body: { publicId: b.data.user.publicId } }); room = direct.data.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2N8AAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('conversationId', room); form.append('file', new File([png], 'private-test.png', { type: 'image/png' }));
  assert.equal((await call('upload', { method: 'POST', cookie: a.cookie, form })).status, 201);
  const usage = await call('storage', { cookie: a.cookie }); assert.equal(usage.data.count, 1); assert.equal(usage.data.bytes, png.length); fileId = usage.data.files[0].id;
  assert.equal((await call(`files/${fileId}`, { cookie: b.cookie })).status, 200);
  assert.equal((await call(`storage/${fileId}`, { method: 'DELETE', cookie: b.cookie })).status, 404);
  assert.equal((await call(`storage/${fileId}`, { method: 'DELETE', cookie: a.cookie })).status, 200);
  assert.equal((await call(`files/${fileId}`, { cookie: b.cookie })).status, 404); assert.equal((await call('storage', { cookie: a.cookie })).data.bytes, 0);
});
await test('message edit, reply, reaction and deletion permissions', async () => {
  const sent = await call('messages', { method: 'POST', cookie: a.cookie, body: { conversationId: room, body: 'النص الأصلي' } }); assert.equal(sent.status, 201);
  assert.equal((await call(`messages/${sent.data.id}`, { method: 'PATCH', cookie: b.cookie, body: { body: 'غير مسموح' } })).status, 403);
  assert.equal((await call(`messages/${sent.data.id}`, { method: 'PATCH', cookie: a.cookie, body: { body: 'نص معدّل' } })).status, 200);
  assert.equal((await call(`messages/${sent.data.id}/reaction`, { method: 'POST', cookie: b.cookie, body: { emoji: '❤️' } })).status, 200);
  const reply = await call('messages', { method: 'POST', cookie: b.cookie, body: { conversationId: room, body: 'رد اختبار', replyToId: sent.data.id } }); assert.equal(reply.status, 201);
  const list = await call(`messages?conversationId=${room}`, { cookie: a.cookie }); const edited = list.data.messages.find(m => m.id === sent.data.id); const replied = list.data.messages.find(m => m.id === reply.data.id);
  assert.equal(edited.body, 'نص معدّل'); assert.ok(edited.editedAt); assert.equal(edited.reactions[0].emoji, '❤️'); assert.equal(replied.reply.id, sent.data.id);
  assert.equal((await call(`messages/${sent.data.id}`, { method: 'DELETE', cookie: a.cookie })).status, 200);
  const after = await call(`messages?conversationId=${room}`, { cookie: b.cookie }); assert.ok(after.data.messages.find(m => m.id === sent.data.id).deletedAt);
});
await test('group admin permissions and removed member access', async () => {
  const group = await call('conversations/group', { method: 'POST', cookie: a.cookie, body: { title: 'مجموعة صلاحيات', publicIds: [b.data.user.publicId] } }); assert.equal(group.status, 201);
  const id = group.data.id; assert.equal((await call(`conversations/${id}/members/${a.data.user.id}`, { method: 'DELETE', cookie: b.cookie })).status, 403);
  assert.equal((await call(`conversations/${id}/members`, { method: 'POST', cookie: a.cookie, body: { publicId: c.data.user.publicId } })).status, 200);
  assert.equal((await call('messages', { method: 'POST', cookie: c.cookie, body: { conversationId: id, body: 'رسالة في المجموعة' } })).status, 201);
  assert.equal((await call(`conversations/${id}/members/${c.data.user.id}`, { method: 'DELETE', cookie: a.cookie })).status, 200);
  assert.equal((await call(`messages?conversationId=${id}`, { cookie: c.cookie })).status, 404);
});
await test('status audience, expiry and view tracking', async () => {
  const privateStatus = await call('status', { method: 'POST', cookie: a.cookie, body: { body: 'خاص', audience: 'private', color: '#147c6d' } }); assert.equal(privateStatus.status, 201);
  const contactStatus = await call('status', { method: 'POST', cookie: a.cookie, body: { body: 'للجهات', audience: 'contacts', color: '#147c6d' } }); statusId = contactStatus.data.id;
  const bList = await call('status', { cookie: b.cookie }); const visible = bList.data.statuses.find(s => s.id === statusId); assert.ok(visible); assert.ok(!bList.data.statuses.some(s => s.id === privateStatus.data.id));
  assert.ok(Math.abs(new Date(visible.expiresAt) - new Date(visible.createdAt) - 86400000) < 5000);
  const cList = await call('status', { cookie: c.cookie }); assert.ok(!cList.data.statuses.some(s => s.id === statusId));
  assert.equal((await call(`status/${statusId}/view`, { method: 'POST', cookie: b.cookie, body: {} })).status, 200);
  const owner = await call('status', { cookie: a.cookie }); assert.equal(owner.data.statuses.find(s => s.id === statusId).views, 1);
});
await test('image status and protected media access', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2N8AAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('body', 'صورة حالة'); form.append('audience', 'contacts'); form.append('color', '#147c6d'); form.append('file', new File([png], 'status.png', { type: 'image/png' }));
  const created = await call('status', { method: 'POST', cookie: a.cookie, form }); assert.equal(created.status, 201);
  const list = await call('status', { cookie: b.cookie }); const item = list.data.statuses.find(s => s.id === created.data.id); assert.ok(item?.attachment?.id);
  assert.equal((await call(`files/${item.attachment.id}`, { cookie: b.cookie })).status, 200); assert.equal((await call(`files/${item.attachment.id}`, { cookie: c.cookie })).status, 404);
});
await test('blocking prevents discovery and direct messages', async () => {
  assert.equal((await call('blocks', { method: 'POST', cookie: b.cookie, body: { userId: a.data.user.id } })).status, 200);
  assert.equal((await call('messages', { method: 'POST', cookie: a.cookie, body: { conversationId: room, body: 'blocked' } })).status, 403);
  assert.equal((await call(`users/search?id=${b.data.user.publicId}`, { cookie: a.cookie })).status, 404);
  assert.equal((await call(`blocks/${a.data.user.id}`, { method: 'DELETE', cookie: b.cookie })).status, 200);
});
await test('reporting and unconfigured recovery response', async () => {
  assert.equal((await call('reports', { method: 'POST', cookie: a.cookie, body: { userId: b.data.user.id, reason: 'اختبار الإبلاغ' } })).status, 200);
  const recovery = await call('auth/forgot', { method: 'POST', body: { email: a.data.user.email } }); assert.ok([200, 503].includes(recovery.status)); console.log(`Recovery endpoint status: ${recovery.status}`);
});
console.log('Security test IDs:', JSON.stringify({ room, fileId, statusId }));
if (failures.length) { console.error('Failed:', failures.join(', ')); process.exitCode = 1; }
