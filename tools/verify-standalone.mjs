/** Vérifie que le fichier unique fonctionne SANS réseau (file:// + requêtes bloquées). */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errs = [], requests = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
// bloque TOUTES les requêtes réseau hors file://
await page.route('**', route => {
  const u = route.request().url();
  requests.push(u);
  if (u.startsWith('file://')) return route.continue();
  return route.abort();
});
const htmlPath = resolve(process.env.STANDALONE_HTML ?? 'index.html');
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
await page.waitForTimeout(2000);
console.log('erreurs au chargement :', errs.slice(0,6).join(' | ') || 'aucune');
console.log('__tka :', await page.evaluate(() => typeof window.__tka));
const menuOk = await page.evaluate(() => !!document.getElementById('playBtn') && document.querySelectorAll('.statRow').length > 0);
await page.evaluate(() => { window.__tka.start({ quality: 'low' }); });
await page.waitForTimeout(800);
await page.evaluate(() => { window.__tka.pauseLoop(); window.__tka.skipCountdown(); window.__tka.step(120); });
const stats = await page.evaluate(() => window.__tka.engine()?.stats ?? null);
await page.screenshot({ path: '/home/user/verify.png' });
console.log('menu rendu :', menuOk, '| stats :', JSON.stringify(stats));
console.log('requêtes réseau tentées :', requests.filter(u => !u.startsWith('file://')).length);
if (errs.length) console.log('ERREURS :', errs.slice(0,5).join(' | '));
await browser.close();
