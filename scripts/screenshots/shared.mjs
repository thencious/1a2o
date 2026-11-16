import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from '../../apps/web/node_modules/@playwright/test/index.mjs';

export const root = resolve(import.meta.dirname, '../..');
export const app = resolve(root, 'apps/web');
export const output = resolve(root, 'docs/screenshots');
const require = createRequire(resolve(root, 'package.json'));
const esbuild = require(require.resolve('esbuild', { paths: [dirname(require.resolve('tsx'))] }));
const pointer = resolve(root, '.context/active-web-build.json');
const build = existsSync(pointer) ? JSON.parse(readFileSync(pointer, 'utf8')).directory : '.next';
const chunks = resolve(app, build, 'static/chunks');
if (!existsSync(chunks)) throw new Error('Build the web app before capturing its current CSS.');
export const css = readdirSync(chunks).filter(name => name.endsWith('.css')).map(name => readFileSync(resolve(chunks, name), 'utf8')).join('\n');
mkdirSync(output, { recursive: true });

export async function bundle({ source, entry, mocks = {}, boundaries }) {
  const result = await esbuild.build({
    ...(entry ? { entryPoints: [resolve(root, entry)] } : { stdin: { contents: source, resolveDir: root, loader: 'tsx' } }),
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    tsconfig: resolve(app, 'tsconfig.json'), nodePaths: [resolve(app, 'node_modules')],
    alias: { '@': app, react: resolve(app, 'node_modules/react'), 'react-dom': resolve(app, 'node_modules/react-dom'), swr: resolve(app, 'node_modules/swr') },
    define: { 'process.env': '{"NODE_ENV":"production"}' },
    plugins: [{ name: 'showcase-fixtures', setup(build) {
      build.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'showcase' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'showcase' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: app }));
      boundaries?.(build);
    } }],
  });
  return result.outputFiles.find(file => file.path.endsWith('.js') || file.path === '<stdout>')?.text ?? result.outputFiles[0].text;
}

export function html(script, extra = '', bootstrap = '') {
  return `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:#202020;color:#ddd;font:14px system-ui;color-scheme:dark}#root{min-height:100vh}*,::before,::after{animation:none!important;transition:none!important}${extra}</style></head><body>${bootstrap}<div id="root"></div><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

export async function capture(name, config) {
  const script = await bundle(config);
  const browser = await chromium.launch({ channel: process.env.SCREENSHOT_BROWSER ?? 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: config.viewport ?? { width: 1440, height: 960 }, colorScheme: 'dark', timezoneId: 'America/Los_Angeles' });
    const errors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://localhost:3996') return route.abort();
      if (config.route && await config.route(route, url)) return;
      if (url.pathname === '/showcase') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html(script, config.style ?? '', config.bootstrap ?? '') });
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => {errors.push(error.message); console.error('Showcase error:',error.message);});
    await page.clock.setFixedTime(new Date('2026-10-30T19:00:00Z'));
    await config.init?.(page, context);
    await page.goto('http://localhost:3996/showcase');
    try { await config.ready?.(page); } catch(error) { console.error((await page.locator('body').innerText()).slice(0,2500)); throw error; }
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled', fullPage: config.fullPage ?? false });
    if (config.mobile) {
      await page.setViewportSize({ width: 412, height: 892 });
      await config.mobile(page);
      await page.screenshot({ path: resolve(output, `${name}-mobile.png`), animations: 'disabled' });
    }
    if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
    console.log(`Captured ${name} using synthetic fixtures.`);
  } finally { await browser.close(); }
}

export const basics = {
  'next/link': `import React from'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
  'next/image': `import React from'react';export default function Image({unoptimized,priority,...props}){return <img {...props}/>}`,
  '@/components/LoadingContent': `import React from'react';export const LoadingContent=({loading,error,children})=>error?<p>Unable to load fixture</p>:loading?<p>Loading</p>:children;`,
  '@/utils/error': `export const getActionErrorMessage=result=>result.serverError||'Operation failed';export const captureException=()=>{};`,
};

export function writeGalleryManifest() {
  const captures = readdirSync(output).filter(name => name.endsWith('.png')).sort().map(file => ({
    file,
    sha256: createHash('sha256').update(readFileSync(resolve(output, file))).digest('hex'),
    data: 'fictional-fixture',
    ...(file.endsWith('-mobile.png') ? { device: 'responsive browser viewport; not Android emulator' } : {}),
  }));
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    method: 'Current app components in an isolated browser harness; fake providers; external origins blocked.',
    realProviderOperations: false,
    syntheticTerminalOutput: true,
    syntheticPairingLink: true,
    captures,
  }, null, 2) + '\n');
}
