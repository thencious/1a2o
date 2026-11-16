import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from '../../apps/web/node_modules/@playwright/test/index.mjs';
import { root, output, writeGalleryManifest } from './shared.mjs';

const publicRoot = resolve(root, 'apps/web/public/open-todo-zero');
const now = Date.parse('2026-10-30T19:00:00Z');
const task = (id, title, priority, extra = {}) => ({ id, title, confirmedTitle: title, notes: '', priority, createdAt: now - 86400000, aiState: 'success', ...extra });
const states = {
  tasks: { revision: 'showcase', tasks: [
    task('review', 'Review launch checklist', 'important', { notes: '# Review launch checklist\n\nBefore the release:\n\n- [ ] Confirm account connections\n- [ ] Test calendar editing\n- [ ] Check the mobile onboarding flow\n- [ ] Review accessibility feedback\n\n## Handoff\nSend the final checklist to Morgan after the design review.', estimatedSeconds: 1800, deadline: { at: now - 3600000, source: 'manual', kind: 'calendar' } }),
    task('proposal', 'Send the revised proposal', 'urgent', { estimatedSeconds: 900, deadline: { at: now + 7200000, source: 'manual', kind: 'calendar' } }),
    task('feedback', 'Review the mobile design feedback', 'important', { estimatedSeconds: 2400 }),
    task('agenda', 'Prepare the workshop agenda', 'important', { estimatedSeconds: 1200, deadline: { at: now + 86400000, source: 'manual', kind: 'calendar' } }),
    task('notes', 'Organize research notes', 'unimportant', { estimatedSeconds: 1200 }),
    task('photos', 'Share photos from the meetup', 'unimportant', { estimatedSeconds: 600 }),
  ] },
  notes: { revision: 'showcase', tasks: [
    { id: 'launch', title: 'Launch planning', notes: '# Launch planning\n\nA shared place for decisions, follow-ups, and ideas.\n\n## Next steps\n\n- Finish the accessibility review\n- Confirm the workshop date with Morgan\n- Send the revised proposal tomorrow at 2 PM\n\n## Design principles\n\n1. Keep setup clear and welcoming.\n2. Show useful defaults before advanced options.\n3. Preserve unfinished work when switching tabs.\n\n## Meeting notes\n\nThe team agreed to focus on the mobile flow first. We will review the updated calendar and inbox screens at the next check-in.\n\n> Turn the next step into a task when you are ready.\n\n### References\n\n[Project overview](https://example.com/project) · [Research summary](https://example.org/research)', createdAt: now - 86400000 * 3, updatedAt: now - 900000 },
    { id: 'research', title: 'Customer research', notes: '# Customer research\n\nQuestions and observations from recent interviews.', createdAt: now - 86400000 * 4, updatedAt: now - 3600000 },
    { id: 'ideas', title: 'Workshop ideas', notes: '# Workshop ideas\n\nExercises for the next design workshop.', createdAt: now - 86400000 * 2 },
    { id: 'reading', title: 'Reading list', notes: '# Reading list\n\nArticles about accessible interfaces.', createdAt: now - 86400000 * 6 },
    { id: 'travel', title: 'Weekend plans', notes: '# Weekend plans\n\nA few places to visit and things to do.', createdAt: now - 86400000 * 7 },
  ] },
};
const preferences = { policy: { autoAnalyze: false, estimateWork: true, urgentEnabled: true, remindersEnabled: false, calendarTimed: true, calendarAllDay: true }, defaultCalendar: null };
const browser = await chromium.launch({ channel: process.env.SCREENSHOT_BROWSER ?? 'msedge', headless: true });
try {
  for (const workspace of ['tasks', 'notes']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark', timezoneId: 'America/Los_Angeles' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://localhost:3996') return route.abort();
      if (url.pathname === '/showcase') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><style>body{margin:0;background:#202020}iframe{border:0;width:100%;height:100vh}</style><iframe src="/api/user/todo/app?workspace=${workspace}"></iframe><script>addEventListener('message',e=>{if(e.origin!==location.origin||e.data?.channel!=='inbox-todo')return;e.source.postMessage({channel:'inbox-todo-result',id:e.data.id,data:{configured:true,queued:0,waiting:0,errors:[],pending:[],revision:'showcase'}},location.origin)})</script></html>` });
      if (url.pathname === '/api/user/todo/state') return route.fulfill({ json: states[workspace] });
      if (url.pathname === '/api/user/todo/app') {
        const source = readFileSync(resolve(publicRoot, workspace === 'notes' ? 'notes.html' : 'index.html'), 'utf8');
        const state = { ...states[workspace], workspace, preferences, aiAvailable: true, windowsNotifications: false };
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: source.replace('<!--INBOX_TODO_BOOTSTRAP-->', `<script id="inbox-todo-bootstrap" type="application/json">${JSON.stringify(state).replace(/</g, '\\u003c')}</script>`) });
      }
      if (url.pathname.startsWith('/open-todo-zero/')) {
        const file = resolve(publicRoot, url.pathname.slice('/open-todo-zero/'.length));
        if (!file.startsWith(publicRoot + '/') && !file.startsWith(publicRoot + '\\')) throw new Error('Invalid asset path');
        try { return route.fulfill({ contentType: { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) }); }
        catch { return route.fulfill({ status: 404, body: '' }); }
      }
      return route.fulfill({ json: { calendars: [], warnings: [] } });
    });
    await context.addInitScript(value => { Date.now = () => value; }, now);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:3996/showcase');
    const frame = page.frameLocator('iframe');
    if (workspace === 'notes') {
      await frame.locator('.note-row').filter({ hasText: 'Launch planning' }).click();
      await frame.locator('.cm-editor [contenteditable=true]').waitFor();
    } else {
      await frame.getByRole('button', { name: 'Review launch checklist', exact: true }).click();
      await frame.locator('.cm-editor [contenteditable=true]').waitFor();
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(output, `${workspace}.png`), animations: 'disabled' });
    await page.setViewportSize({width:412,height:892});
    await page.waitForTimeout(150);
    await page.screenshot({path:resolve(output, `${workspace}-mobile.png`),animations:'disabled'});
    console.log(workspace+' mobile overflow: '+await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
    if (errors.length) throw new Error(`${workspace}: ${errors.join('; ')}`);
    console.log(`Captured ${workspace} with fictional task/note state.`);
    await context.close();
  }
} finally { await browser.close(); }
writeGalleryManifest();
