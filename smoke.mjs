import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';

// Run against a started application: BASE_URL=http://127.0.0.1:3000 node scripts/smoke.mjs
// Chromium uses fake cameras/microphones. This is not a cross-network or mobile-device test.
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const stamp = Date.now();
const password = 'Test-pass-8492!';
const failures = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const a = await contextA.newPage();
const b = await contextB.newPage();
const errors = [];
for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
async function test(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); } }
async function register(page, name, email) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('.welcome-card button').click();
  await page.locator('.auth-form input').first().fill(name);
  await page.locator('.auth-form input[type=email]').fill(email);
  await page.locator('.auth-form input[type=password]').fill(password);
  await page.locator('.auth-submit').click();
  await page.locator('.id-card strong').waitFor({ timeout: 15000 });
  return (await page.locator('.id-card strong').innerText()).trim();
}
let idA = '', idB = '', videoBuffer = null;
await test('two independent browser accounts', async () => {
  idA = await register(a, 'اختبار المتصفح ألف', `browser-a-${stamp}@example.test`);
  idB = await register(b, 'اختبار المتصفح باء', `browser-b-${stamp}@example.test`);
  assert.match(idA, /^[A-Z0-9]{8}$/); assert.match(idB, /^[A-Z0-9]{8}$/); assert.notEqual(idA, idB);
});
await test('ID search, profile preview and direct chat', async () => {
  assert.ok(idB); await a.locator('.new-chat-btn').click(); await a.locator('input[placeholder="ABC123XY"]').fill(idB); await a.locator('.lookup-input button').click();
  await a.locator('.found-profile strong').waitFor(); assert.equal(await a.locator('.found-profile strong').innerText(), 'اختبار المتصفح باء');
  await a.locator('.found-profile button').click(); await a.locator('.chat-person strong').waitFor(); assert.equal(await a.locator('.chat-person strong').innerText(), 'اختبار المتصفح باء');
  await b.locator('.conversation-row').first().waitFor({ timeout: 12000 }); await b.locator('.conversation-row').first().click();
});
await test('two-way text and read receipt', async () => {
  const one = `رسالة من ألف ${stamp}`, two = `رد من باء ${stamp}`;
  await a.locator('.composer textarea').fill(one);
  await b.locator('.chat-person small').filter({ hasText: 'يكتب الآن' }).waitFor({ timeout: 10000 });
  await a.locator('.composer textarea').press('Enter');
  await b.locator('.message-text').filter({ hasText: one }).first().waitFor({ timeout: 15000 });
  await b.locator('.composer textarea').fill(two); await b.locator('.composer textarea').press('Enter');
  await a.locator('.message-text').filter({ hasText: two }).first().waitFor({ timeout: 15000 });
  await a.waitForFunction(() => !!document.querySelector('.message-row.mine .message-meta svg.read'), null, { timeout: 15000 });
});
await test('forward text through the interface', async () => {
  const sent = a.locator('.message-row.mine').filter({ hasText: `رسالة من ألف ${stamp}` }).first(); await sent.hover(); await sent.locator('.message-menu-trigger').click();
  await sent.getByRole('button', { name: 'إعادة توجيه النص' }).click(); await a.locator('.forward-list button').filter({ hasText: 'اختبار المتصفح باء' }).click();
  await b.locator('.message-text').filter({ hasText: `↪ رسالة من ألف ${stamp}` }).first().waitFor({ timeout: 15000 });
});
await test('image upload and recipient preview', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2N8AAAAASUVORK5CYII=', 'base64');
  await a.locator('.composer input[type=file]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
  await a.getByRole('button', { name: 'إرسال الملف' }).click();
  await b.locator('.message-image img[src^="/api/files/"]').first().waitFor({ timeout: 15000 });
  assert.equal(await b.locator('.message-image img[src^="/api/files/"]').first().evaluate(i => i.complete && i.naturalWidth > 0), true);
});
await test('video upload and recipient preview', async () => {
  const bytes = await a.evaluate(async () => { const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0d806b'; ctx.fillRect(0,0,96,96); const stream = canvas.captureStream(10); const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }); const chunks = []; recorder.ondataavailable = e => chunks.push(e.data); const done = new Promise(resolve => recorder.onstop = resolve); recorder.start(); await new Promise(resolve => setTimeout(resolve, 800)); recorder.stop(); await done; stream.getTracks().forEach(t => t.stop()); return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())); });
  videoBuffer = Buffer.from(bytes);
  await a.locator('.composer input[type=file]').setInputFiles({ name: 'test.webm', mimeType: 'video/webm', buffer: videoBuffer });
  await a.getByRole('button', { name: 'إرسال الملف' }).click(); await b.locator('video.message-video').first().waitFor({ timeout: 15000 });
});
await test('microphone recording and voice message', async () => {
  await a.locator('.mic-btn').click(); await a.locator('.recording-label').waitFor(); await a.waitForTimeout(1600); await a.locator('.mic-btn').click();
  await b.locator('audio.message-audio').first().waitFor({ timeout: 18000 });
});
async function call(mode) {
  const label = mode === 'audio' ? 'مكالمة صوتية' : 'مكالمة فيديو';
  await a.locator(`.chat-header button[aria-label="${label}"]`).click();
  await b.locator('.call-card button[aria-label="قبول"]').waitFor({ timeout: 18000 }); await b.locator('.call-card button[aria-label="قبول"]').click();
  if (mode === 'audio') {
    for (const page of [a,b]) await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(el => el.srcObject && el.srcObject.getAudioTracks().some(track => track.readyState === 'live')), null, { timeout: 30000 });
  } else {
    for (const page of [a,b]) await page.waitForFunction(() => { const el = document.querySelector('video.remote-video'); return el?.srcObject && el.srcObject.getVideoTracks().some(track => track.readyState === 'live'); }, null, { timeout: 30000 });
  }
  await a.locator('.call-card button[aria-label="إنهاء المكالمة"]').click(); await b.locator('.call-card').waitFor({ state: 'hidden', timeout: 12000 });
}
await test('local WebRTC audio call with fake devices', async () => call('audio'));
await test('local WebRTC video call with fake devices', async () => call('video'));
await test('status creation and contact view', async () => {
  await a.locator('.rail-item[aria-label="الحالة"]').click(); await a.locator('.status-board .primary-button').click();
  await a.locator('.modal-form textarea').fill(`حالة اختبار ${stamp}`); await a.getByRole('button', { name: 'مشاركة الحالة' }).click();
  await a.locator('.status-tile').first().waitFor({ timeout: 10000 });
  await b.locator('.rail-item[aria-label="الحالة"]').click(); await b.locator('.status-person').first().waitFor({ timeout: 15000 }); await b.locator('.status-person').first().click();
  assert.ok((await b.locator('.status-viewer').innerText()).includes(`حالة اختبار ${stamp}`)); await b.locator('.status-viewer-top button').click();
});
await test('video status visible to a contact', async () => {
  assert.ok(videoBuffer); await a.locator('.status-board .primary-button').click();
  await a.locator('.modal-form input[type=file]').setInputFiles({ name: 'status.webm', mimeType: 'video/webm', buffer: videoBuffer });
  const posted = a.waitForResponse(r => r.url().endsWith('/api/status') && r.request().method() === 'POST'); await a.getByRole('button', { name: 'مشاركة الحالة' }).click(); const created = await (await posted).json(); assert.ok(created.id);
  await b.locator('.rail-item[aria-label="المحادثات"]').click(); const loaded = b.waitForResponse(r => r.url().endsWith('/api/status') && r.request().method() === 'GET'); await b.locator('.rail-item[aria-label="الحالة"]').click(); const list = await (await loaded).json(); assert.ok(list.statuses.some(s => s.id === created.id));
  await b.waitForTimeout(500); await b.locator('.status-person').first().click(); await b.locator('.status-viewer video').waitFor(); await b.locator('.status-viewer-top button').click();
});
await test('call history visible in settings', async () => {
  await a.locator('.rail-item[aria-label="الإعدادات"]').click(); await a.locator('.settings-menu-row').filter({ hasText: 'سجل المكالمات' }).click();
  await a.locator('.account-settings .expand-row').filter({ hasText: 'اختبار المتصفح باء' }).first().waitFor({ timeout: 10000 });
  assert.ok(await a.locator('.account-settings .expand-row').filter({ hasText: 'اختبار المتصفح باء' }).count() >= 2);
});
await test('language switch, direction and persisted preference', async () => {
  await a.locator('.rail-item[aria-label="الإعدادات"]').click(); await a.locator('.settings-main .select-button').click();
  await a.waitForFunction(() => document.documentElement.dir === 'ltr'); assert.equal(await a.locator('.settings-main h1').innerText(), 'Settings');
  await a.reload(); await a.waitForFunction(() => document.documentElement.dir === 'ltr');
  await a.locator('.rail-item[aria-label="Settings"]').click(); await a.locator('.settings-main .select-button').click(); await a.waitForFunction(() => document.documentElement.dir === 'rtl');
});
await test('manifest and active service worker', async () => {
  const result = await a.evaluate(async () => { const reg = await navigator.serviceWorker.ready; const manifest = await (await fetch('/manifest.webmanifest')).json(); return { active: !!reg.active, display: manifest.display, icons: manifest.icons.length }; });
  assert.equal(result.active, true); assert.equal(result.display, 'standalone'); assert.ok(result.icons >= 2);
  const cdp = await contextA.newCDPSession(a); const installability = await cdp.send('Page.getInstallabilityErrors'); console.log('Chromium installability errors:', JSON.stringify(installability.installabilityErrors)); await cdp.detach();
});
console.log('Browser page errors:', JSON.stringify(errors));
console.log('Test public IDs:', idA, idB);
await browser.close();
if (failures.length || errors.length) { console.error('Failed:', failures.join(', ')); process.exitCode = 1; }
