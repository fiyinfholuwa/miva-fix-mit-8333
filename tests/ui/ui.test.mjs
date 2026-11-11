/**
 * MivaFix frontend end-to-end tests (Playwright, real browser, real API).
 *
 * Usage (from tests/):  npm install && npm run test:ui
 * Env: MIVAFIX_WEB (default http://localhost:5500), HEADED=1 to watch.
 * Requires the API on :8000 and the frontend on :5500 with the seeded demo accounts.
 */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.MIVAFIX_WEB || 'http://localhost:5500';
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
const results = [];
const run = Math.random().toString(16).slice(2, 6);
const png = path.join(os.tmpdir(), `mivafix-ui-${run}.png`);
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

async function test(group, name, fn, viewport = { width: 1366, height: 860 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await fn(page);
    assert.deepEqual(errors, [], `uncaught page errors: ${errors.join('; ')}`);
    results.push([group, name, true]);
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    results.push([group, name, false, error.message]);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m\n    → ${error.message.split('\n')[0]}`);
  } finally {
    await context.close();
  }
}
const section = title => { console.log(`\n\x1b[1m${title}\x1b[0m`); return title; };

async function login(page, who) {
  await page.goto(`${BASE}/login.html`);
  await page.fill('input[name=email]', `${who}@miva.test`);
  await page.fill('input[name=password]', 'Password123!');
  await page.click('#login-form [type=submit]');
  await page.waitForURL('**/index.html');
  await page.waitForSelector('.metric-grid');
}

console.log(`MivaFix UI tests against ${BASE}`);

let g = section('Authentication pages');
await test(g, 'Login shows inline errors for empty and malformed fields', async page => {
  await page.goto(`${BASE}/login.html`);
  await page.click('#login-form [type=submit]');
  assert.equal(await page.locator('.has-error').count(), 2);
  await page.fill('input[name=email]', 'not-an-email');
  await page.click('#login-form [type=submit]');
  assert.match(await page.locator('.has-error .field-error').first().innerText(), /valid email/i);
});
await test(g, 'Wrong password shows a form-level alert and stays on login', async page => {
  await page.goto(`${BASE}/login.html`);
  await page.fill('input[name=email]', 'student@miva.test');
  await page.fill('input[name=password]', 'WrongPassword!');
  await page.click('#login-form [type=submit]');
  await page.waitForSelector('.form-alert');
  assert.match(await page.locator('.form-alert').innerText(), /not recognised/i);
  assert.ok(page.url().endsWith('login.html'));
});
await test(g, 'Password visibility toggle switches the input type', async page => {
  await page.goto(`${BASE}/login.html`);
  await page.click('[data-toggle-password]');
  assert.equal(await page.getAttribute('input[name=password]', 'type'), 'text');
});
await test(g, 'Registration validates password confirmation and strength meter', async page => {
  await page.goto(`${BASE}/register.html`);
  await page.fill('input[name=full_name]', 'UI Tester');
  await page.fill('input[name=email]', `ui.${run}@miva.test`);
  await page.fill('input[name=password]', 'Abcdef12!');
  assert.equal(await page.getAttribute('#password-strength', 'data-level'), '4');
  await page.fill('input[name=password_confirm]', 'Different1!');
  await page.click('#register-form [type=submit]');
  assert.match(await page.locator('.has-error .field-error').innerText(), /do not match/i);
});
await test(g, 'Successful registration lands on the student dashboard', async page => {
  await page.goto(`${BASE}/register.html`);
  await page.fill('input[name=full_name]', 'UI Tester');
  await page.fill('input[name=email]', `ui.${run}@miva.test`);
  await page.fill('input[name=password]', 'Abcdef12!');
  await page.fill('input[name=password_confirm]', 'Abcdef12!');
  await page.click('#register-form [type=submit]');
  await page.waitForURL('**/index.html');
  await page.waitForSelector('.empty-state');
  assert.match(await page.locator('.page-header h1').innerText(), /your service requests/i);
});
await test(g, 'Demo buttons sign in each role', async page => {
  await page.goto(`${BASE}/login.html`);
  await page.click('[data-demo="officer@miva.test"]');
  await page.waitForURL('**/index.html');
  await page.waitForSelector('.user-chip');
  assert.match(await page.locator('.user-chip').innerText(), /Maintenance Officer/);
});

g = section('Role-based dashboards & navigation');
await test(g, 'Student sees requester navigation and a New request action', async page => {
  await login(page, 'student');
  const nav = await page.locator('.main-nav').innerText();
  assert.match(nav, /My requests/); assert.doesNotMatch(nav, /Admin centre/);
  assert.ok(await page.locator('.page-header [data-open-new-request]').isVisible());
  assert.equal(await page.locator('.metric-card').count(), 4);
});
await test(g, 'Officer sees "My work" and no request-creation controls', async page => {
  await login(page, 'officer');
  assert.match(await page.locator('.main-nav').innerText(), /My work/);
  assert.equal(await page.locator('[data-open-new-request]').count(), 0);
});
await test(g, 'Administrator sees the Admin centre link', async page => {
  await login(page, 'admin');
  assert.match(await page.locator('.main-nav').innerText(), /Admin centre/);
});
await test(g, 'Non-admins are redirected away from admin.html', async page => {
  await login(page, 'student');
  await page.goto(`${BASE}/admin.html`);
  await page.waitForURL('**/index.html');
});
await test(g, 'Unauthenticated visitors are redirected to login', async page => {
  await page.goto(`${BASE}/requests.html`);
  await page.waitForURL('**/login.html');
});

g = section('Service request form & tracking');
let ticket = '';
await test(g, 'New request form shows inline validation for every required field', async page => {
  await login(page, 'student');
  await page.click('.page-header [data-open-new-request]');
  await page.click('#request-form [type=submit]');
  assert.equal(await page.locator('#request-form .has-error').count(), 4);
  await page.fill('textarea[name=description]', 'Too short');
  assert.match(await page.locator('[data-count-for=description]').innerText(), /min 15/);
});
await test(g, 'Evidence picker previews the image', async page => {
  await login(page, 'student');
  await page.click('.page-header [data-open-new-request]');
  await page.setInputFiles('input[name=evidence]', png);
  await page.waitForSelector('#dropzone-preview img');
});
await test(g, 'Escape closes the modal', async page => {
  await login(page, 'student');
  await page.click('.page-header [data-open-new-request]');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.modal').count(), 0);
});
await test(g, 'Student submits a request with evidence and sees it tracked', async page => {
  await login(page, 'student');
  await page.click('.page-header [data-open-new-request]');
  await page.fill('input[name=title]', `UI test: socket sparks ${run}`);
  await page.selectOption('select[name=category_id]', { label: 'Electrical' });
  await page.selectOption('select[name=priority]', 'urgent');
  await page.fill('input[name=location]', 'Block D, Room 12');
  await page.fill('textarea[name=description]', 'The wall socket near the window sparks when anything is plugged in.');
  await page.setInputFiles('input[name=evidence]', png);
  await page.click('#request-form [type=submit]');
  await page.waitForSelector('.toast.success');
  await page.waitForSelector('.modal .stepper');
  ticket = (await page.locator('.modal .ticket').innerText()).trim();
  assert.match(ticket, /^MFX-/);
  assert.ok(await page.locator('.modal .evidence img').isVisible(), 'evidence thumbnail should show');
  assert.match(await page.locator('.step.current').innerText(), /Submitted/);
});
await test(g, 'Requests page search finds the new ticket', async page => {
  await login(page, 'student');
  await page.goto(`${BASE}/requests.html`);
  await page.waitForSelector('#req-results table');
  await page.fill('#req-search', ticket);
  await page.waitForFunction(t => document.querySelectorAll('#req-results tbody tr').length === 1 && document.querySelector('#req-results tbody').innerText.includes(t), ticket);
});
await test(g, 'Status filter is applied and reflected in the URL', async page => {
  await login(page, 'student');
  await page.goto(`${BASE}/requests.html`);
  await page.waitForSelector('#req-results table');
  await page.selectOption('#req-status', 'completed');
  await page.waitForFunction(() => location.search.includes('status=completed'));
  await page.waitForFunction(() => [...document.querySelectorAll('#req-results .status-pill')].every(p => p.classList.contains('status-completed')));
});

g = section('Admin & officer workflow');
await test(g, 'Admin assigns the new request to an officer', async page => {
  await login(page, 'admin');
  await page.goto(`${BASE}/admin.html`);
  await page.waitForSelector('#admin-results table');
  await page.fill('#admin-search', ticket);
  await page.waitForFunction(() => document.querySelectorAll('#admin-results tbody tr').length === 1);
  await page.click('#admin-results [data-detail]');
  await page.waitForSelector('#assign-form');
  await page.selectOption('#assign-form select', { index: 1 });
  await page.click('#assign-form [type=submit]');
  await page.waitForSelector('.toast.success');
  await page.waitForFunction(() => document.querySelector('.step.current')?.innerText.includes('Assigned'));
});
await test(g, 'Officer records progress with a note; requester is notified', async page => {
  await login(page, 'officer');
  await page.goto(`${BASE}/requests.html`);
  await page.waitForSelector('#req-results table');
  await page.fill('#req-search', ticket);
  await page.waitForFunction(() => document.querySelectorAll('#req-results tbody tr').length === 1);
  await page.click('#req-results [data-detail]');
  await page.waitForSelector('#status-form');
  assert.equal(await page.inputValue('#status-form select'), 'in_progress', 'next logical status should be preselected');
  await page.fill('#status-form textarea', 'Isolated the circuit; replacing socket.');
  await page.click('#status-form [type=submit]');
  await page.waitForFunction(() => document.querySelector('.timeline')?.innerText.includes('Isolated the circuit'));
});
await test(g, 'Requester opens notifications and jumps to the request', async page => {
  await login(page, 'student');
  await page.click('#notification-button');
  await page.waitForSelector('[data-notification-request]');
  await page.locator('[data-notification-request]').first().click();
  await page.waitForSelector('.modal .stepper');
});
await test(g, 'Admin tabs switch between requests, users and reports', async page => {
  await login(page, 'admin');
  await page.goto(`${BASE}/admin.html`);
  await page.click('[data-admin-tab=users]');
  await page.waitForSelector('#admin-users table');
  await page.selectOption('#user-role', 'maintenance_officer');
  const roles = await page.locator('#admin-users .role-pill').allInnerTexts();
  assert.ok(roles.length > 0 && roles.every(r => /Maintenance Officer/.test(r)));
  await page.click('[data-admin-tab=reports]');
  assert.ok(await page.locator('[data-export=pdf]').isVisible());
});
await test(g, 'Export rejects an end date before the start date', async page => {
  await login(page, 'admin');
  await page.goto(`${BASE}/admin.html`);
  await page.click('[data-admin-tab=reports]');
  await page.fill('#export-from', '2026-05-10');
  await page.fill('#export-to', '2026-05-01');
  await page.click('[data-export=csv]');
  assert.match(await page.locator('.has-error .field-error').innerText(), /on or after/);
});
await test(g, 'CSV export downloads a file', async page => {
  await login(page, 'admin');
  await page.goto(`${BASE}/admin.html`);
  await page.click('[data-admin-tab=reports]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-export=csv]')]);
  assert.equal(download.suggestedFilename(), 'mivafix-requests.csv');
});

g = section('Responsive layout');
await test(g, 'Mobile menu opens and closes the sidebar', async page => {
  await login(page, 'student');
  assert.ok(await page.locator('#mobile-menu').isVisible());
  await page.click('#mobile-menu');
  await page.waitForFunction(() => document.querySelector('#sidebar').classList.contains('open'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sidebar').classList.contains('open'));
}, { width: 390, height: 844 });
await test(g, 'No horizontal page overflow at phone width', async page => {
  await login(page, 'admin');
  await page.goto(`${BASE}/requests.html`);
  await page.waitForSelector('#req-results table');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page overflows by ${overflow}px`);
}, { width: 390, height: 844 });

await browser.close();
fs.unlinkSync(png);
const passed = results.filter(r => r[2]).length;
console.log(`\n${passed === results.length ? '\x1b[32m' : '\x1b[31m'}${passed} / ${results.length} UI tests passed\x1b[0m`);
process.exit(passed === results.length ? 0 : 1);
