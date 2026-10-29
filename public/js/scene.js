/* Escena 3D de fondo: calaveras de azúcar flotando, velas, ánimas y pétalos (Three.js) */
import * as THREE from 'three';

const canvas = document.getElementById('bg3d');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = window.matchMedia('(max-width: 768px)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  canvas.remove();
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0410, 0.045);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 10);

const ambient = new THREE.AmbientLight(0x4a2560, 1.4);
scene.add(ambient);
const moon = new THREE.DirectionalLight(0x9fb4ff, 0.7);
moon.position.set(-6, 8, 6);
scene.add(moon);
const lightningLight = new THREE.DirectionalLight(0xdfe8ff, 0);
lightningLight.position.set(4, 10, 8);
scene.add(lightningLight);

/* ---- Calavera de azúcar hecha con primitivas ---- */
const boneMat = new THREE.MeshStandardMaterial({ color: 0xeee2c9, roughness: 0.55, metalness: 0.05, flatShading: true });
const darkMat = new THREE.MeshBasicMaterial({ color: 0x050005 });
function makeSkull(eyeColor, flowerColor) {
  const g = new THREE.Group();
  const cranium = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), boneMat);
  cranium.scale.set(1, 1.05, 1.1);
  g.add(cranium);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.85), boneMat);
  jaw.position.set(0, -0.9, 0.25);
  g.add(jaw);
  const socketGeo = new THREE.SphereGeometry(0.29, 16, 12);
  const glowMat = new THREE.MeshBasicMaterial({ color: eyeColor });
  for (const x of [-0.38, 0.38]) {
    const s = new THREE.Mesh(socketGeo, darkMat);
    s.position.set(x, -0.12, 0.93);
    s.scale.set(1, 1.1, 0.55);
    g.add(s);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), glowMat);
    glow.position.set(x, -0.12, 1.04);
    g.add(glow);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 3), darkMat);
  nose.position.set(0, -0.48, 1.02);
  nose.rotation.x = Math.PI;
  g.add(nose);
  for (let i = -2; i <= 2; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.1), boneMat);
    t.position.set(i * 0.16, -0.78, 0.75);
    g.add(t);
  }
  // Flor en la frente (cempasúchil)
  const petalMat = new THREE.MeshStandardMaterial({ color: flowerColor, emissive: flowerColor, emissiveIntensity: 0.35, roughness: 0.4 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), petalMat);
    p.position.set(Math.cos(a) * 0.18, 0.5 + Math.sin(a) * 0.18, 0.96);
    g.add(p);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe0218a, emissive: 0xe0218a, emissiveIntensity: 0.4 }));
  center.position.set(0, 0.5, 1.02);
  g.add(center);
  // Puntos decorativos en mejillas
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x2ad1c0 });
  for (const x of [-0.62, 0.62]) {
    for (let k = 0; k < 3; k++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), dotMat);
      dot.position.set(x + (x > 0 ? 0.05 : -0.05) * k, -0.45 - k * 0.09, 0.8 - k * 0.04);
      g.add(dot);
    }
  }
  return g;
}

const skulls = [];
const skullDefs = [
  { pos: [-6.2, 2.4, -4], s: 1.1, eye: 0xff2244, flower: 0xff8a00 },
  { pos: [6.4, -1.8, -5], s: 1.3, eye: 0x2ad1c0, flower: 0xffb627 },
  { pos: [-3.5, -4.2, -9], s: 1.0, eye: 0xffb627, flower: 0xe0218a },
  { pos: [4.2, 4.6, -11], s: 1.4, eye: 0xff2244, flower: 0xff8a00 },
  { pos: [0, -1, -16], s: 2.2, eye: 0xb44dff, flower: 0xffb627 }
];
skullDefs.slice(0, mobile ? 3 : 5).forEach((d, i) => {
  const sk = makeSkull(d.eye, d.flower);
  sk.position.set(...d.pos);
  sk.scale.setScalar(d.s);
  sk.userData = { base: new THREE.Vector3(...d.pos), phase: i * 1.7, spin: 0.15 + Math.random() * 0.2 };
  scene.add(sk);
  skulls.push(sk);
});

/* ---- Velas flotantes con luz ---- */
const candles = [];
const waxMat = new THREE.MeshStandardMaterial({ color: 0xf3e6c8, roughness: 0.85 });
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb627 });
const candleDefs = [[-4.5, -2.5, -2], [3.2, 2.8, -3], [-1.6, 3.6, -6], [5.5, 1.2, -8], [-6.5, -0.5, -10], [1.8, -3.6, -6]];
candleDefs.slice(0, mobile ? 4 : 6).forEach((p, i) => {
  const g = new THREE.Group();
  const h = 0.8 + Math.random() * 0.6;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, h, 12), waxMat);
  g.add(body);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 10), flameMat);
  flame.position.y = h / 2 + 0.16;
  g.add(flame);
  if (i < 3) {
    const light = new THREE.PointLight(0xff9a2a, 6, 7, 1.6);
    light.position.y = h / 2 + 0.3;
    g.add(light);
    g.userData.light = light;
  }
  g.position.set(...p);
  g.userData.base = new THREE.Vector3(...p);
  g.userData.phase = i * 1.3;
  g.userData.flame = flame;
  scene.add(g);
  candles.push(g);
});

/* ---- Textura circular suave para partículas ---- */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const tex = dotTexture();

/* ---- Pétalos 3D (partículas) ---- */
const N = mobile ? 350 : 900;
const pos = new Float32Array(N * 3);
const col = new Float32Array(N * 3);
const speed = new Float32Array(N);
const palette = [new THREE.Color(0xff8a00), new THREE.Color(0xffb627), new THREE.Color(0xffd000), new THREE.Color(0xe0218a), new THREE.Color(0xff5a1f)];
for (let i = 0; i < N; i++) {
  pos[i * 3] = (Math.random() - 0.5) * 30;
  pos[i * 3 + 1] = (Math.random() - 0.5) * 20;
  pos[i * 3 + 2] = -Math.random() * 22 + 4;
  const c = palette[(Math.random() * palette.length) | 0];
  col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  speed[i] = 0.4 + Math.random() * 1.1;
}
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
  size: 0.16, map: tex, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9, blending: THREE.AdditiveBlending
}));
scene.add(points);

/* ---- Ánimas (luces errantes) ---- */
const spirits = [];
const spiritColors = [0x2ad1c0, 0xb44dff, 0xffb627, 0xff2244, 0x7fe8ff];
for (let i = 0; i < (mobile ? 3 : 5); i++) {
  const m = new THREE.SpriteMaterial({ map: tex, color: spiritColors[i], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(1.4 + Math.random());
  s.userData = { a: 3 + Math.random() * 5, b: 2 + Math.random() * 3, z: -3 - Math.random() * 8, sp: 0.15 + Math.random() * 0.2, ph: Math.random() * 6 };
  scene.add(s);
  spirits.push(s);
}

/* ---- Interacción ---- */
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
window.addEventListener('pointermove', (e) => {
  mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
  mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
}, { passive: true });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
let strike = 0;
document.addEventListener('pdm:lightning', () => { strike = 1; });

const t0 = performance.now();
let last = t0;
function tick() {
  const now = performance.now();
  const t = (now - t0) / 1000;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  mouse.x += (mouse.tx - mouse.x) * 0.04;
  mouse.y += (mouse.ty - mouse.y) * 0.04;
  const scroll = window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight);
  camera.position.x = mouse.x * 1.4;
  camera.position.y = -mouse.y * 0.9 - scroll * 2;
  camera.position.z = 10 - scroll * 4;
  camera.lookAt(0, -scroll * 2, -6);

  skulls.forEach((s) => {
    const u = s.userData;
    s.position.y = u.base.y + Math.sin(t * 0.6 + u.phase) * 0.5;
    s.position.x = u.base.x + Math.cos(t * 0.3 + u.phase) * 0.3;
    s.rotation.y = Math.sin(t * u.spin + u.phase) * 0.7 + mouse.x * 0.35;
    s.rotation.x = Math.sin(t * 0.4 + u.phase) * 0.15 + mouse.y * 0.2;
    s.rotation.z = Math.sin(t * 0.25 + u.phase) * 0.1;
  });
  candles.forEach((c) => {
    const u = c.userData;
    c.position.y = u.base.y + Math.sin(t * 0.8 + u.phase) * 0.35;
    c.rotation.z = Math.sin(t * 0.5 + u.phase) * 0.12;
    const f = 0.85 + Math.sin(t * 13 + u.phase) * 0.08 + Math.random() * 0.1;
    u.flame.scale.set(f, f * (1 + Math.random() * 0.15), f);
    if (u.light) u.light.intensity = 5 + Math.random() * 2.2;
  });
  const p = pGeo.attributes.position.array;
  for (let i = 0; i < N; i++) {
    p[i * 3 + 1] -= speed[i] * dt * 0.9;
    p[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.25;
    if (p[i * 3 + 1] < -11) p[i * 3 + 1] = 11;
  }
  pGeo.attributes.position.needsUpdate = true;
  points.rotation.y = Math.sin(t * 0.05) * 0.2;
  spirits.forEach((s) => {
    const u = s.userData;
    s.position.set(Math.sin(t * u.sp + u.ph) * u.a, Math.cos(t * u.sp * 1.3 + u.ph) * u.b, u.z + Math.sin(t * 0.2 + u.ph) * 2);
    s.material.opacity = 0.45 + Math.sin(t * 2 + u.ph) * 0.25;
  });
  if (strike > 0) {
    lightningLight.intensity = strike * 6 * (Math.random() > 0.3 ? 1 : 0.2);
    strike -= 0.03;
  } else lightningLight.intensity = 0;

  renderer.render(scene, camera);
}

if (reduce) {
  tick();
} else {
  renderer.setAnimationLoop(() => { if (!document.hidden) tick(); });
}
