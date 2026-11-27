import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

THREE.Cache.enabled = true;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- shared model loading (one download per file) ----
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const pending = {};
// Phones get the same models with 1024px textures (‑m.glb): 4096px textures can exhaust iOS GPU memory and render black.
const PHONE = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 820;
const mapUrl = (u) => PHONE ? u.replace(/^(figure-hd|fig[2-6])\.glb$/, '$1-m.glb') : u;
function loadModel(url, onProgress) {
  url = mapUrl(url);
  if (!pending[url]) {
    pending[url] = new Promise((res, rej) => gltfLoader.load(url, (g) => {
      const m = g.scene;
      const b = new THREE.Box3().setFromObject(m);
      const c = b.getCenter(new THREE.Vector3());
      m.position.set(-c.x, -b.min.y, -c.z);
      const p = new THREE.Group();
      p.add(m);
      res(p);
    }, onProgress, (e) => { delete pending[url]; rej(e); }));
  }
  return pending[url];
}
function dropModel(url) {
  url = mapUrl(url);
  const pr = pending[url]; if (!pr) return; delete pending[url];
  pr.then((g) => g.traverse((o) => {
    if (!o.isMesh) return; o.geometry.dispose();
    [].concat(o.material).forEach((m) => { Object.values(m).forEach((v) => v && v.isTexture && v.dispose()); m.dispose(); });
  })).catch(() => {});
}
const keyPending = {};
function loadKey(url) {
  if (!keyPending[url]) {
    keyPending[url] = new Promise((res, rej) => gltfLoader.load(url, (g) => {
      const inner = new THREE.Group(); inner.add(g.scene); inner.rotation.x = Math.PI / 2 - 0.45;
      const wrap = new THREE.Group(); wrap.add(inner);
      const b = new THREE.Box3().setFromObject(wrap); const c = b.getCenter(new THREE.Vector3()); const sz = b.getSize(new THREE.Vector3());
      inner.position.sub(c);
      const k = 1 / sz.x; wrap.scale.setScalar(k);
      wrap.userData.h = sz.y * k;
      g.scene.traverse((o) => { if (o.isMesh) o.userData.plate = !(o.material && o.material.name === 'Material.001'); });
      const out = new THREE.Group(); out.add(wrap); out.userData.h = wrap.userData.h;
      res(out);
    }, undefined, rej));
  }
  return keyPending[url];
}
// Can this browser draw WebGL at all? (disabled GPU, blocked WebGL, old devices → photos only)
const canWebGL = (() => {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
})();
/* One switch for the whole site: if 3D fails anywhere in a way that means "this device/connection can't do it"
   (no WebGL, lost context, black render, too slow), every 3D spot falls back to photos for this visit. */
const SW = { on: canWebGL, off(reason) { if (!this.on) return; this.on = false; document.documentElement.classList.add('no3d'); window.dispatchEvent(new CustomEvent('sw3d-off', { detail: reason })); } };
window.sw3d = SW;
if (!canWebGL) document.documentElement.classList.add('no3d');
// A frame where the figure is drawn almost completely black = textures were dropped. Sample a vertical strip.
function looksBlack(renderer) {
  try {
    const gl = renderer.getContext(), c = renderer.domElement, w = 24, h = Math.max(8, c.height >> 1);
    const x = (c.width >> 1) - (w >> 1), y = c.height >> 2, px = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, sum = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) { n++; sum += Math.max(px[i], px[i + 1], px[i + 2]); }
    return n > w * h * 0.08 && sum / n < 14;
  } catch (e) { return false; }
}
function makeRenderer() {
  if (!canWebGL) throw new Error('WebGL unavailable');
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  return r;
}
function addLights(scene, rimColor = 0xffffff) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x24378d, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(1.5, 2.5, 2.5); scene.add(key);
  const rim = new THREE.DirectionalLight(rimColor, 2.0); rim.position.set(-2, 1.5, -2); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-2, 0.5, 2); scene.add(fill);
}
function softShadow(size = 0.75) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(20,20,40,.5)'); grd.addColorStop(1, 'rgba(20,20,40,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.002;
  return m;
}
function fitTo(el, renderer, camera) {
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---- hero: a product photo shows from the first paint; the 3D figure replaces it
// only after the model has loaded AND drawn a frame. Any failure simply leaves the photo. ----
{
  const stage = document.getElementById('stage');
  const hero = document.getElementById('hero');
  const photo = document.querySelector('.hero-photo');
  let renderer;
  try { renderer = makeRenderer(); } catch (e) { renderer = null; }
  if (renderer && stage) {
    stage.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
    const tanH = Math.tan(14 * Math.PI / 180);
    const narrowHero = () => innerWidth <= 600;
    addLights(scene, 0x9fe6ff);
    const pivot = new THREE.Group(); scene.add(pivot); scene.add(softShadow());
    let model = null, H = 1, shown = false, dead = false, frames = 0;
    const giveUp = (why) => { dead = true; document.body.classList.remove('hero3d'); stage.remove(); try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {} SW.off(why); };
    renderer.domElement.addEventListener('webglcontextlost', () => giveUp('context-lost'));
    window.addEventListener('sw3d-off', () => { if (!dead) giveUp('elsewhere'); });
    // too slow → photo stays for good (the model keeps nothing on screen)
    const slow = setTimeout(() => { if (!shown) giveUp('slow'); }, PHONE ? 15000 : 20000);
    loadModel(stage.dataset.model).then((m) => {
      if (dead) return;
      H = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).y || 1;
      pivot.add(m); model = m;
    }).catch(() => giveUp('load-error'));

    // Frame the 3D figure where the photo sits (photo top → head, photo bottom → feet).
    let topF = 0.15, feetF = 0.81;
    const measure = () => {
      const pr = stage.getBoundingClientRect(), r = photo && photo.getBoundingClientRect();
      if (r && r.height && pr.height) { topF = (r.top - pr.top) / pr.height; feetF = (r.bottom - pr.top) / pr.height; }
    };
    let mx = 0, my = 0, tx = 0, ty = 0, prog = 0;
    addEventListener('pointermove', (e) => { mx = (e.clientX / innerWidth - 0.5) * 2; my = (e.clientY / innerHeight - 0.5) * 2; });
    new ResizeObserver(() => { fitTo(stage, renderer, camera); measure(); }).observe(stage);
    fitTo(stage, renderer, camera); measure();
    const clock = new THREE.Clock();
    const tick = () => {
      if (dead) return;
      const r = hero.getBoundingClientRect();
      if (r.bottom > 0 && model) {
        const t = clock.getElapsedTime();
        const target = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
        prog += (target - prog) * 0.12;
        tx += (mx - tx) * 0.05; ty += (my - ty) * 0.05;
        pivot.rotation.y = prog * Math.PI * 2 + (reduce ? 0 : tx * 0.25);
        pivot.rotation.x = reduce ? 0 : ty * 0.04;
        pivot.position.y = reduce ? 0 : Math.sin(t * 1.4) * 0.008;
        // phones: no zoom while it spins, so the feet never leave the frame
        const zoom = narrowHero() ? 0 : Math.sin(prog * Math.PI);
        const f = Math.max(0.3, feetF - topF);
        const d0 = H / (2 * tanH * f);
        const look0 = d0 * tanH * (2 * feetF - 1);
        const dist = d0 * (1 - zoom * 0.36);
        const lookY = look0 + (H * 0.72 - look0) * zoom * 0.5;
        camera.position.set(0, lookY + 0.05, dist);
        camera.lookAt(0, lookY, 0);
        renderer.render(scene, camera);
        frames++;
        if ((frames === 3 || frames % 90 === 0) && frames < 1200 && looksBlack(renderer)) { giveUp('black'); return; }
        if (!shown && frames >= 3) { shown = true; clearTimeout(slow); document.body.classList.add('hero3d'); }
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
  // the scroll-driven text animation runs with or without 3D
  const setP = () => {
    const r = hero.getBoundingClientRect();
    if (r.bottom > 0) document.documentElement.style.setProperty('--p', Math.min(1, Math.max(0, -r.top / (r.height - innerHeight))).toFixed(4));
  };
  addEventListener('scroll', setP, { passive: true }); setP();
}

// ---- product popup viewer (drag to rotate) ----
{
  let vr, vs, vc, ctl, holder, raf = 0, ro, current = null, openId = 0, failCb = null;
  function setup() {
    vr = makeRenderer();
    vs = new THREE.Scene(); addLights(vs); vs.add(softShadow(0.8));
    vc = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    ctl = new OrbitControls(vc, vr.domElement);
    ctl.enablePan = false; ctl.enableDamping = true;
    ctl.minDistance = 0.6; ctl.maxDistance = 3.2; ctl.minPolarAngle = 0.3; ctl.maxPolarAngle = 1.9;
    ctl.autoRotateSpeed = 1.6;
    ctl.addEventListener('start', () => { ctl.autoRotate = false; });
    vr.domElement.style.touchAction = 'none';
    vr.domElement.addEventListener('webglcontextlost', () => { if (holder) { holder.classList.remove('ready'); holder.classList.add('no3d'); } failCb && failCb(); SW.off('context-lost'); });
  }
  let firstFrame = null, frames = 0, currentUrl = null;
  const loop = () => {
    ctl.update(); vr.render(vs, vc);
    if (current) {
      frames++;
      if ((frames === 3 || frames % 90 === 0) && frames < 900 && looksBlack(vr)) { const f = failCb; holder && holder.classList.remove('ready'); f && f(); SW.off('black'); return; }
      if (firstFrame && frames >= 3) { const f = firstFrame; firstFrame = null; f(); }
    }
    raf = requestAnimationFrame(loop);
  };
  window.addEventListener('sw3d-off', () => { if (failCb) failCb(); });
  window.swViewer = {
    get supported() { return SW.on; },
    open(el, url, opts = {}) {
      let failed = false;
      const fail = () => { if (failed) return; failed = true; clearTimeout(slow); el.classList.add('no3d'); cancelAnimationFrame(raf); opts.onFail && opts.onFail(); };
      const slow = setTimeout(() => { if (!el.classList.contains('ready')) { fail(); SW.off('slow'); } }, PHONE ? 12000 : 15000);
      if (!SW.on) { fail(); return; }
      try { if (!vr) setup(); } catch (e) { fail(); SW.off('no-webgl'); return; }
      holder = el; failCb = fail; const id = ++openId; frames = 0;
      el.appendChild(vr.domElement);
      Object.assign(vr.domElement.style, { width: '100%', height: '100%', display: 'block' });
      if (current) { vs.remove(current); current = null; }
      // phones keep only one portfolio model in memory
      if (PHONE && currentUrl && currentUrl !== url) dropModel(currentUrl);
      currentUrl = url;
      vc.position.set(0, 0.55, 2.4); ctl.target.set(0, 0.5, 0); ctl.minDistance = 0.6; ctl.maxDistance = 3.2; ctl.autoRotate = !reduce;
      el.classList.remove('ready');
      (opts.key ? loadKey(url).then((k) => { const g = new THREE.Group(); const c = k.clone(true); const m = new THREE.MeshStandardMaterial({ color: 0x2f9fe0, roughness: 0.35 }); c.traverse((o) => { if (o.isMesh && o.userData.plate) o.material = m; }); c.scale.setScalar(0.9); c.position.y = 0.5; g.add(c); return g; }) : loadModel(url))
        .then((m) => {
          if (holder !== el || id !== openId) return; current = m; vs.add(m);
          if (!opts.key) { // frame any model height (e.g. a keychain with its ring and chain)
            const h = Math.max(1, new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).y);
            vc.position.set(0, 0.55 * h, 2.4 * h); ctl.target.set(0, 0.5 * h, 0);
            ctl.minDistance = 0.6 * h; ctl.maxDistance = 3.2 * h; ctl.update();
          }
          // reveal the 3D only once a frame with the model has actually been drawn
          firstFrame = () => { if (holder === el && id === openId && !failed) { clearTimeout(slow); el.classList.add('ready'); } };
        })
        .catch(() => { if (holder === el && id === openId) fail(); });
      ro = new ResizeObserver(() => fitTo(el, vr, vc)); ro.observe(el); fitTo(el, vr, vc);
      cancelAnimationFrame(raf); loop();
    },
    close() { cancelAnimationFrame(raf); raf = 0; if (ro) ro.disconnect(); holder = null; failCb = null; firstFrame = null; }
  };
}

// ---- calculator preview: the model reacts to the chosen options ----
{
  const box = document.getElementById('calcView');
  if (box) {
    const urls = { simple: box.dataset.low, medium: box.dataset.med, complex: box.dataset.high }; const keyUrl = box.dataset.key;
    let r, scene, cam, ctl, group, ring, spec = null, started = false, visible = false, raf = 0, token = 0;
    const clay = new THREE.MeshStandardMaterial({ color: 0xd2d2d0, roughness: 0.55 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.25, metalness: 1 });
    const solids = {};
    const solidMat = (hex) => solids[hex] || (solids[hex] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.35 }));
    const sizeScale = { 5: 0.36, 10: 0.52, 15: 0.66, 20: 0.82, 25: 1, 26: 1.08 };
    const fov = 30, tanH = Math.tan((fov / 2) * Math.PI / 180);
    let fitDist = 2.2, minH = 1.1, lastFit = 0, slowT = 0, dead = false;
    // no 3D here → the whole visualizer goes away (the price list stays)
    function off() {
      if (dead) return; dead = true; clearTimeout(slowT); cancelAnimationFrame(raf);
      box.classList.add('no3d'); document.documentElement.classList.add('calc-no3d');
      if (r) { try { r.dispose(); r.forceContextLoss(); } catch (e) {} }
    }
    window.addEventListener('sw3d-off', off);

    function start() {
      started = true;
      if (!SW.on) { off(); return; }
      try { r = makeRenderer(); } catch (e) { off(); return; }
      box.prepend(r.domElement);
      r.domElement.addEventListener('webglcontextlost', () => { off(); SW.off('context-lost'); });
      slowT = setTimeout(() => { if (!box.classList.contains('ready3d')) { off(); SW.off('slow'); } }, PHONE ? 15000 : 20000);
      Object.assign(r.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'pan-y' });
      scene = new THREE.Scene(); addLights(scene, 0x9fe6ff);
      const sh = softShadow(3.2); scene.add(sh);
      const pm = new THREE.PMREMGenerator(r);
      const env = new THREE.Scene(); env.background = new THREE.Color(0x9fd8f0);
      scene.environment = pm.fromScene(env).texture; scene.environmentIntensity = 0.45;
      cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 80);
      ctl = new OrbitControls(cam, r.domElement);
      ctl.enablePan = false; ctl.enableZoom = false; ctl.enableDamping = true;
      ctl.minPolarAngle = 0.4; ctl.maxPolarAngle = 1.75;
      ctl.autoRotate = !reduce; ctl.autoRotateSpeed = 1.6;
      ctl.addEventListener('start', () => { ctl.autoRotate = false; });
      group = new THREE.Group(); scene.add(group);
      ring = new THREE.Group();
      const torus = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 16, 48), metal); torus.position.y = 0.11;
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 12, 32), metal); link.rotation.y = Math.PI / 2;
      ring.add(torus, link);
      new ResizeObserver(() => { fitTo(box, r, cam); frame(false); }).observe(box);
      fitTo(box, r, cam);
      if (spec) build(spec);
      loop();
    }
    function loop() {
      cancelAnimationFrame(raf);
      if (!visible || dead) { raf = 0; return; }
      ctl.update(); r.render(scene, cam);
      raf = requestAnimationFrame(loop);
    }
    function paint(obj, mat) {
      obj.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.userData.orig) o.userData.orig = o.material;
        o.material = mat || o.userData.orig;
      });
    }
    // camera distance that fits the whole group (never closer than one 25 cm+ figure)
    function frame(resetAngle) {
      if (!cam || !group.children.length) return;
      const b = new THREE.Box3().setFromObject(group);
      const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const h = Math.max(size.y, minH), w = Math.max(size.x, size.z, minH > 1 ? 0.6 : 0.25);
      fitDist = Math.max(h / (2 * tanH), w / (2 * tanH * cam.aspect)) * 1.18 + size.z * 0.5;
      const ty = minH > 1 ? Math.max(c.y, 0.45) : c.y;
      ctl.target.set(c.x, ty, 0);
      ctl.minDistance = fitDist * 0.15; ctl.maxDistance = fitDist * 1.8;
      const refit = !lastFit || fitDist / lastFit > 1.12 || fitDist / lastFit < 0.89;
      lastFit = fitDist;
      if (resetAngle) cam.position.set(c.x, ty + fitDist * 0.08, fitDist);
      else {
        const off = cam.position.clone().sub(ctl.target);
        off.setLength(refit ? fitDist : Math.min(Math.max(off.length(), ctl.minDistance), ctl.maxDistance));
        cam.position.copy(ctl.target).add(off);
      }
    }
    async function build(sp) {
      const my = ++token;
      box.classList.add('busy');
      const items = sp.items.slice(0, 10);
      const figs = items.filter((it) => it.kind !== 'key'), keys = items.filter((it) => it.kind === 'key');
      const many = figs.length > 3;
      const lod = (it) => (many ? (it.details === 'complex' ? 'medium' : 'simple') : it.details);
      let models, keyBase = null;
      try {
        const need = [...new Set(figs.map((it) => urls[lod(it)]))];
        models = Object.fromEntries(await Promise.all(need.map(async (u) => [u, await loadModel(u)])));
        if (keys.length) keyBase = await loadKey(keyUrl);
      } catch (e) { box.classList.remove('busy'); off(); return; }
      if (dead) return;
      if (my !== token) return;
      const prevCount = group.children.length;
      group.clear();
      // figures: rows of up to 5 standing on the floor
      const placed = figs.map((it) => {
        const c = models[urls[lod(it)]].clone(true);
        paint(c, it.paint === 'painted' ? null : it.paint === 'solid' ? solidMat(it.color) : clay);
        const sc = sizeScale[it.size] || 0.66;
        c.scale.setScalar(sc); c.userData.w = 0.42 * sc;
        return c;
      });
      const perRow = 5; let figW = 0;
      for (let row = 0; row * perRow < placed.length; row++) {
        const rowItems = placed.slice(row * perRow, row * perRow + perRow);
        const total = rowItems.reduce((a, o) => a + o.userData.w, 0) + 0.06 * (rowItems.length - 1);
        figW = Math.max(figW, total);
        let x = -total / 2;
        rowItems.forEach((o) => { o.position.set(x + o.userData.w / 2, 0, -row * 0.55); x += o.userData.w + 0.06; group.add(o); });
      }
      // keychains: 5 cm each (a 15 cm figure is 0.66 units tall), hung in a grid of 2 columns
      if (keys.length) {
        const kw = 0.22, kh = keyBase.userData.h * kw, gapX = 0.05, gapY = 0.05, cols = keys.length > 1 ? 2 : 1;
        const rows = Math.ceil(keys.length / cols);
        const blockW = cols * kw + (cols - 1) * gapX;
        const x0 = placed.length ? figW / 2 + 0.15 : -blockW / 2;
        keys.forEach((it, i) => {
          const k = keyBase.clone(true);
          k.traverse((o) => { if (o.isMesh && o.userData.plate) o.material = solidMat(it.color); });
          k.scale.setScalar(kw);
          const col = i % cols, row = Math.floor(i / cols);
          k.position.set(x0 + col * (kw + gapX) + kw / 2, 0.04 + (rows - 1 - row) * (kh + gapY) + kh / 2, 0);
          group.add(k);
        });
      }
      minH = placed.length ? 1.1 : 0.2;
      frame(prevCount === 0 || prevCount !== group.children.length);
      box.classList.remove('busy');
      if (!box.classList.contains('ready3d')) {
        r.render(scene, cam);
        if (placed.length && looksBlack(r)) { off(); SW.off('black'); return; }
        clearTimeout(slowT); requestAnimationFrame(() => box.classList.add('ready3d'));
      }
    }
    function zoomBy(k) {
      if (!cam) return;
      const off = cam.position.clone().sub(ctl.target);
      off.setLength(Math.min(Math.max(off.length() * k, ctl.minDistance), ctl.maxDistance));
      cam.position.copy(ctl.target).add(off);
      ctl.autoRotate = false;
    }
    window.swCalc = {
      update(sp) { spec = sp; if (started && r) build(sp); },
      zoom: zoomBy,
      setFull(on) {
        if (!ctl) return;
        ctl.enableZoom = on;
        r.domElement.style.touchAction = on ? 'none' : 'pan-y';
        requestAnimationFrame(() => { fitTo(box, r, cam); frame(false); });
      }
    };
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting || box.classList.contains('full');
      if (visible && !started) start();
      else if (visible && r && !dead) loop();
    }, { rootMargin: '200px' }).observe(box);
  }
}
