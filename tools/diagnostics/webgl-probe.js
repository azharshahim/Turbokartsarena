// Test-only driver handle accounting, NOT physical VRAM measurement.
(() => {
  const contexts = [], original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
    const gl = original.call(this, kind, ...args);
    if (!gl || !String(kind).startsWith('webgl') || contexts.some(c => c.gl === gl)) return gl;
    const c = { gl, canvas: this, counts: {}, objects: {}, created: {}, deleted: {}, bytes: new Map() };
    contexts.push(c);
    const wrap = (name, fn) => { const original = gl[name]; gl[name] = function(...a) { return fn(original.bind(gl), a); }; };
    for (const type of ['Texture', 'Renderbuffer', 'Framebuffer', 'Buffer', 'Program', 'Shader']) {
      c.objects[type] = new Set();
      c.counts[type] = c.created[type] = c.deleted[type] = 0;
      wrap(`create${type}`, (f, a) => { const o = f(...a); if (o) { c.objects[type].add(o); c.created[type]++; } return o; });
      wrap(`delete${type}`, (f, a) => { if (a[0]) { c.objects[type].delete(a[0]); c.deleted[type]++; c.bytes.delete(a[0]); } return f(...a); });
    }
    let unit = gl.TEXTURE0, rb = null; const bindings = new Map();
    this.addEventListener('webglcontextlost', () => { for (const objects of Object.values(c.objects)) objects.clear(); c.bytes.clear(); bindings.clear(); rb = null; });
    wrap('activeTexture', (f, a) => { unit = a[0]; return f(...a); });
    wrap('bindTexture', (f, a) => { bindings.set(`${unit}/${a[0]}`, a[1]); return f(...a); });
    wrap('bindRenderbuffer', (f, a) => { rb = a[1]; return f(...a); });
    const bpp = format => ({ 34842:8, 34843:6, 34836:16, 34837:12, 33189:2, 33190:4, 36012:4, 33321:1, 33323:2 }[format] || 4);
    const put = (object, key, bytes) => { if (!object) return; if (!c.bytes.has(object)) c.bytes.set(object, new Map()); c.bytes.get(object).set(key, bytes); };
    wrap('texImage2D', (f, a) => {
      const cube = a[0] >= 34069 && a[0] <= 34074;
      const tex = bindings.get(`${unit}/${cube ? gl.TEXTURE_CUBE_MAP : a[0]}`);
      const w = a.length >= 9 ? a[3] : a[5]?.width || 0, h = a.length >= 9 ? a[4] : a[5]?.height || 0;
      put(tex, `${a[0]}/${a[1]}`, w*h*bpp(a[2])); return f(...a);
    });
    if (gl.texStorage2D) wrap('texStorage2D', (f, a) => {
      let bytes = 0; for (let i=0;i<a[1];i++) bytes += Math.max(1,a[3]>>i)*Math.max(1,a[4]>>i)*bpp(a[2]);
      put(bindings.get(`${unit}/${a[0]}`), 'storage', bytes*(a[0]===gl.TEXTURE_CUBE_MAP?6:1)); return f(...a);
    });
    wrap('renderbufferStorage', (f,a) => { put(rb,'storage',a[2]*a[3]*bpp(a[1])); return f(...a); });
    if (gl.renderbufferStorageMultisample) wrap('renderbufferStorageMultisample',(f,a)=>{put(rb,'storage',Math.max(1,a[1])*a[3]*a[4]*bpp(a[2]));return f(...a);});
    return gl;
  };
  window.__gpuProbe = () => contexts.map(c => ({ canvas: c.canvas.id, connected: c.canvas.isConnected, lost: c.gl.isContextLost(),
    live: Object.fromEntries(Object.entries(c.objects).map(([k,v])=>[k,v.size])), created: {...c.created}, deleted: {...c.deleted},
    estimatedTextureRenderbufferBytes: [...c.bytes.values()].reduce((s,m)=>s+[...m.values()].reduce((a,b)=>a+b,0),0) }));
})();
