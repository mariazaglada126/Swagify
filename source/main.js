import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

THREE.Cache.enabled = true;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- shared model loading (one download per file) ----
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const pending = {};
function loadModel(url, onProgress) {
  if (!pending[url]) {
    pending[url] = new Promise((res, rej) => gltfLoader.load(url, (g) => {
      const m = g.scene;
      const b = new THREE.Box3().setFromObject(m);
      const c = b.getCenter(new THREE.Vector3());
      m.position.set(-c.x, -b.min.y, -c.z);
      const p = new THREE.Group();
      p.add(m);
      res(p);
    }, onProgress, rej));
  }
  return pending[url];
}
function makeRenderer() {
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

// ---- hero: figure turns 360° while the poster is pinned ----
{
  const stage = document.getElementById('stage');
  const hero = document.getElementById('hero');
  const loader = document.getElementById('loader');
  let renderer;
  try { renderer = makeRenderer(); } catch (e) { document.body.classList.add('no3d'); }
  if (renderer && stage) {
    stage.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
    addLights(scene, 0x9fe6ff);
    const pivot = new THREE.Group(); scene.add(pivot); scene.add(softShadow());
    loadModel(stage.dataset.model, (p) => {
      if (p.total) loader.querySelector('b').textContent = Math.round((p.loaded / p.total) * 100) + '%';
    }).then((m) => { pivot.add(m); loader.hidden = true; document.body.classList.add('ready'); })
      .catch(() => { loader.hidden = true; document.body.classList.add('no3d'); });

    let mx = 0, my = 0, tx = 0, ty = 0, prog = 0;
    addEventListener('pointermove', (e) => { mx = (e.clientX / innerWidth - 0.5) * 2; my = (e.clientY / innerHeight - 0.5) * 2; });
    new ResizeObserver(() => fitTo(stage, renderer, camera)).observe(stage);
    fitTo(stage, renderer, camera);
    const clock = new THREE.Clock();
    const tick = () => {
      const r = hero.getBoundingClientRect();
      if (r.bottom > 0) {
        const t = clock.getElapsedTime();
        const target = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
        prog += (target - prog) * 0.12;
        document.documentElement.style.setProperty('--p', prog.toFixed(4));
        tx += (mx - tx) * 0.05; ty += (my - ty) * 0.05;
        pivot.rotation.y = prog * Math.PI * 2 + (reduce ? 0 : tx * 0.25);
        pivot.rotation.x = reduce ? 0 : ty * 0.04;
        pivot.position.y = reduce ? 0 : Math.sin(t * 1.4) * 0.008;
        const zoom = Math.sin(prog * Math.PI);
        const narrow = camera.aspect < 0.8;
        const dist = (narrow ? 3.3 : 2.35) - zoom * (narrow ? 0.9 : 0.85);
        const lookY = 0.5 + zoom * 0.22;
        camera.position.set(0, lookY + 0.05, dist);
        camera.lookAt(0, lookY, 0);
        renderer.render(scene, camera);
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
}

// ---- product popup viewer (drag to rotate) ----
{
  let vr, vs, vc, ctl, holder, raf = 0, ro, current = null;
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
  }
  const loop = () => { ctl.update(); vr.render(vs, vc); raf = requestAnimationFrame(loop); };
  window.swViewer = {
    open(el, url) {
      try { if (!vr) setup(); } catch (e) { el.classList.add('no3d'); return; }
      holder = el;
      el.appendChild(vr.domElement);
      Object.assign(vr.domElement.style, { width: '100%', height: '100%', display: 'block' });
      if (current) vs.remove(current);
      vc.position.set(0, 0.55, 2.4); ctl.target.set(0, 0.5, 0); ctl.autoRotate = !reduce;
      el.classList.remove('ready');
      loadModel(url).then((m) => { if (holder !== el) return; current = m; vs.add(m); el.classList.add('ready'); })
        .catch(() => el.classList.add('no3d'));
      ro = new ResizeObserver(() => fitTo(el, vr, vc)); ro.observe(el); fitTo(el, vr, vc);
      cancelAnimationFrame(raf); loop();
    },
    close() { cancelAnimationFrame(raf); raf = 0; if (ro) ro.disconnect(); holder = null; }
  };
}

// ---- calculator preview: the model reacts to the chosen options ----
{
  const box = document.getElementById('calcView');
  if (box) {
    const urls = { simple: box.dataset.low, medium: box.dataset.med, complex: box.dataset.high };
    let r, scene, cam, ctl, group, ring, state = null, started = false, visible = false, raf = 0;
    const clay = new THREE.MeshStandardMaterial({ color: 0xd2d2d0, roughness: 0.55, metalness: 0 });
    const solid = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.25, metalness: 1 });
    const sizeScale = { 10: 0.52, 15: 0.66, 20: 0.82, 25: 1, 26: 1.08 };
    let token = 0;

    function start() {
      started = true;
      try { r = makeRenderer(); } catch (e) { box.classList.add('no3d'); return; }
      box.appendChild(r.domElement);
      Object.assign(r.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'pan-y' });
      scene = new THREE.Scene(); addLights(scene, 0x9fe6ff); scene.add(softShadow(1.4));
      const pm = new THREE.PMREMGenerator(r);
      const env = new THREE.Scene(); env.background = new THREE.Color(0x9fd8f0);
      scene.environment = pm.fromScene(env).texture;
      cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
      cam.position.set(0, 0.55, 2.15);
      ctl = new OrbitControls(cam, r.domElement);
      ctl.target.set(0, 0.45, 0); ctl.enablePan = false; ctl.enableZoom = false; ctl.enableDamping = true;
      ctl.minPolarAngle = 0.6; ctl.maxPolarAngle = 1.7;
      ctl.autoRotate = !reduce; ctl.autoRotateSpeed = 2;
      ctl.addEventListener('start', () => { ctl.autoRotate = false; });
      group = new THREE.Group(); scene.add(group);
      ring = new THREE.Group();
      const torus = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 16, 48), metal);
      torus.position.y = 0.11;
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 12, 32), metal);
      link.rotation.y = Math.PI / 2;
      ring.add(torus, link);
      new ResizeObserver(() => fitTo(box, r, cam)).observe(box);
      fitTo(box, r, cam);
      if (state) build(state);
      loop();
    }
    function loop() {
      cancelAnimationFrame(raf);
      if (!visible) { raf = 0; return; }
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
    async function build(s) {
      const my = ++token;
      box.classList.add('busy');
      const url = s.mode === 'keychain' ? urls.simple : urls[s.details];
      let base;
      try { base = await loadModel(url); } catch (e) { box.classList.add('no3d'); return; }
      if (my !== token) return;
      group.clear();
      if (s.mode === 'keychain') {
        const k = base.clone(true);
        solid.color.set(s.color);
        paint(k, solid);
        k.scale.setScalar(0.55);
        const rg = ring.clone(); rg.position.y = 0.57;
        const kc = new THREE.Group(); kc.add(k, rg); kc.position.y = 0.12;
        group.add(kc);
      } else {
        const sc = sizeScale[s.size] || 0.66;
        const n = Math.min(s.qty, 3);
        const gap = 0.42 * sc;
        for (let i = 0; i < n; i++) {
          const c = base.clone(true);
          paint(c, s.painted ? null : clay);
          c.scale.setScalar(sc);
          const off = n === 1 ? 0 : (i - (n - 1) / 2) * gap;
          c.position.set(off, 0, i === Math.floor(n / 2) ? 0.06 : -0.08);
          group.add(c);
        }
      }
      box.classList.remove('busy');
    }
    window.swCalc = { update(s) { state = s; if (started && r) build(s); } };
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible && !started) start();
      else if (visible && r) loop();
    }, { rootMargin: '200px' }).observe(box);
  }
}
