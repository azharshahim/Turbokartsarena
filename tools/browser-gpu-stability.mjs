/** Samsung dimensions/UA; software driver measurements, not a Samsung GPU. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve('.'), output = process.env.GPU_OUTPUT || '.preview/gpu-stability';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/Turbokartsarena/')) { res.writeHead(404).end(); return; }
    let file = resolve(root, url.pathname.slice('/Turbokartsarena/'.length) || 'index.html');
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file += '/index.html';
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await mkdir(output, { recursive: true });
const duration = Number(process.env.GPU_TEST_SECONDS || 180), baseline = process.env.GPU_BASELINE === '1';
const report = { baseline, durationSeconds: duration, physicalSamsung: false, samples: [], pageErrors: [], disposal: [] };
let browser;
try {
 browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page = await browser.newPage({viewport:{width:798,height:339},deviceScaleFactor:2.8125,isMobile:true,hasTouch:true,serviceWorkers:'block',
 userAgent:'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36'});
 page.setDefaultTimeout(60000); page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.addInitScript({path:'tools/diagnostics/webgl-probe.js'});
 await page.goto(`http://127.0.0.1:${server.address().port}/Turbokartsarena/`); await page.waitForFunction(()=>!!window.__tka);
 const sample = async label => {
  const s = await page.evaluate(label=>{const e=window.__tka.engine();return{label,wallMs:performance.now(),contexts:window.__gpuProbe(),race:e?{time:e.race.raceTime,phase:e.race.phase,memory:e.renderer.info.memory,ratio:e.currentPixelRatio,dimensions:[e.renderer.domElement.width,e.renderer.domElement.height],lost:e.renderer.getContext().isContextLost(),projectiles:e.projectiles.length,environmentUploaded:!!e.renderer.properties.get(e.scene.environment).__webglTexture}:null}},label);
  report.samples.push(s); return s;
 };
 await sample('garage');
 await page.evaluate(()=>window.__tka.start({circuit:0,quality:'high'})); await page.waitForFunction(()=>!!window.__tka.engine());
 await page.evaluate(()=>{const t=window.__tka;t.pauseLoop();t.engine().race.laps=99;t.engine().race.phase='racing';t.engine().race.countdown=0;t.setAutopilot(true);t.resumeLoop();});
 await sample('race-start');
 const begin=Date.now();
 for(let t=0;t<duration;t+=15){await page.waitForTimeout(Math.min(15,duration-t)*1000);const s=await sample(`race-${Math.round((Date.now()-begin)/1000)}s`);assert.equal(s.race.lost,false,'no spontaneous loss in software driver');if(!baseline)assert.equal(s.contexts.filter(c=>!c.lost).length,1);assert.equal(await page.evaluate(()=>window.__tka.rafActive()),true,'race continues rendering');}
 // Exercise actual internal resolution branches with a fixed CSS viewport.
 report.resolutions=await page.evaluate(()=>{const t=window.__tka,e=t.engine();t.pauseLoop();const r=[];for(const avg of [.1,.001,.1,.001]){e.resizeCooldown=0;e.frameAvg=avg;e.frame(performance.now()+17);r.push({ratio:e.currentPixelRatio,contexts:window.__gpuProbe()});}return r;});
 // Drive 180 seconds of additional fixed-step simulation with periodic real
 // renders. This is separate from the wall-clock soak, not a phone FPS claim.
 if (!baseline) {
  await page.evaluate(()=>{const t=window.__tka;t.pauseLoop();const e=t.engine();e.race.laps=99;e.race.phase='racing';e.autopilot=true;});
  for(let i=0;i<18;i++) {await page.evaluate(()=>{const e=window.__tka.engine();let time=e.lastTime*1000;for(let frame=0;frame<200;frame++)e.frame(time+=50,frame===199);window.__tka.updateHud();});await sample(`simulation-${(i+1)*10}s`);}
 }
 // Restart with live projectiles: no GPU handles may survive their removal.
 report.restart=await page.evaluate(()=>{const e=window.__tka.engine(),gl=e.renderer.getContext();e.combat[0].weapon='projectile';e.firePlayerWeapon();e.frame(performance.now()+17);const before=window.__gpuProbe();e.restart();e.race.phase='racing';e.race.countdown=0;const after=window.__gpuProbe();return{before,after,projectiles:e.projectiles.length,error:gl.getError()};});
 // Force browser loss, then wait for the REAL restoration event; never dispatch it.
 await page.evaluate(()=>{window.__stored=JSON.stringify(localStorage);const e=window.__tka.engine();window.__loss=e.renderer.getContext().getExtension('WEBGL_lose_context');window.__restoreEvents=0;e.renderer.domElement.addEventListener('webglcontextrestored',()=>window.__restoreEvents++);window.__loss.loseContext();});
 await page.waitForFunction(()=>window.__tka.state.paused&&!!window.__tkaBoot.snapshot().failure);
 const frozen=await page.evaluate(()=>window.__tka.engine().race.raceTime);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.__tka.engine().race.raceTime),frozen);
 await page.evaluate(()=>window.__tka.togglePause(false));assert.equal(await page.evaluate(()=>window.__tka.state.paused),true);
 await page.evaluate(()=>window.__loss.restoreContext());await page.waitForFunction(()=>window.__restoreEvents===1&&!window.__tkaBoot.snapshot().failure);
 assert.equal(await page.evaluate(()=>window.__tka.state.paused),true);
 await page.locator('#resumeBtn').tap();await page.waitForFunction(time=>window.__tka.engine().renderer.info.render.triangles>0&&window.__tka.engine().race.raceTime>time,frozen);
 await page.waitForTimeout(500);report.restored=await sample('real-restoration');
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)===window.__stored),true,'save untouched by loss/restore');
 if(!baseline)assert.ok(report.restored.race.environmentUploaded,'GPU-only PBR environment regenerated');
 if(!baseline) {
  report.environment = await page.evaluate(()=>{const e=window.__tka.engine(),r=e.renderer,gl=r.getContext(),target=e.environmentTarget,old=r.getRenderTarget();
    r.setRenderTarget(target);const pixels=new Float32Array(target.width*target.height*4);gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.FLOAT,pixels);
    let invalid=0,lit=0;for(let i=0;i<pixels.length;i+=4){if(!Number.isFinite(pixels[i]+pixels[i+1]+pixels[i+2]))invalid++;if(pixels[i]+pixels[i+1]+pixels[i+2]>.01)lit++;}
    const error=gl.getError();r.setRenderTarget(old);return{invalid,lit,error};});
  assert.equal(report.environment.invalid,0);assert.ok(report.environment.lit>0);assert.equal(report.environment.error,0);
 }
 await page.screenshot({path:`${output}/restored.png`});
 // Snapshot handle counts inside disposal BEFORE forceContextLoss hides leaks.
 for(let i=0;i<3;i++){
  const disposal=await page.evaluate(()=>{const t=window.__tka,e=t.engine();t.pauseLoop();const r=e.renderer,old=r.dispose.bind(r);let snapshot;r.dispose=()=>{snapshot={memory:{...r.info.memory},contexts:window.__gpuProbe()};old();};t.quit();return snapshot;});report.disposal.push(disposal);
  await page.waitForTimeout(100);await sample(`garage-cycle-${i}`);
  if(i<2){await page.evaluate(()=>window.__tka.start({circuit:0,quality:'high'}));await page.waitForFunction(()=>!!window.__tka.engine());await page.waitForTimeout(200);}
 }
 assert.deepEqual(report.pageErrors,[]);
 if(!baseline)for(const d of report.disposal){assert.equal(d.memory.textures,0,'all owned textures disposed before renderer/context destruction');assert.equal(d.memory.geometries,0);const c=d.contexts.findLast(c=>!c.lost);assert.equal(c.live.Framebuffer,0);assert.equal(c.live.Renderbuffer,0);assert.equal(c.live.Buffer,0);}
 if(!baseline) {assert.equal(report.restart.after.at(-1).live.Buffer,report.restart.before.at(-1).live.Buffer-4,'restart releases projectile attributes/index'); const snapshots=report.samples.filter(s=>s.label.startsWith('simulation-')); assert.ok(Math.max(...snapshots.map(s=>s.race.memory.textures))-Math.min(...snapshots.map(s=>s.race.memory.textures))<=1,'no accumulating textures during simulated driving');}
 report.result='PASS';console.log(JSON.stringify({result:report.result,baseline,duration,disposal:report.disposal.map(d=>d.memory),environmentUploaded:report.restored.race.environmentUploaded}));
} finally {await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser?.close();await new Promise(done=>server.close(done));}
