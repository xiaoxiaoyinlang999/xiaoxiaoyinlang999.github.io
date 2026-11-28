// webgl-hero.js — 银狼介绍页「以太数据流」粒子背景（webgl-craft 纪律 v1）
// 渐进增强：任何失败都静默退场，页面保持原样。
// 调试钩子：?still=1 静帧 | ?q=low|high 粒子档 | G.step(n) 推帧 | G.report() 打印计数器
import * as THREE from './three.module.min.js';

const canvas = document.getElementById('hero-gl');
const hero = document.querySelector('.hero');
if (!canvas || !hero) { /* 没接线，安静退出 */ }
else init();

function init() {
  const params = new URLSearchParams(location.search);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = params.has('still');
  const quality = params.get('q') || (innerWidth < 720 ? 'low' : 'high');
  const COUNT = quality === 'low' ? 900 : 1800;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  } catch (e) { return fail(e); }

  const DPR_CAP = 2;
  renderer.setPixelRatio(Math.min(devicePixelRatio, DPR_CAP));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
  camera.position.set(0, 0, 18);

  // ---- 粒子：位置/尺寸/色相/速度 全属性化，单 draw call ----
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const seeds = mulberry(20261128);
  const DEPTH = 60;               // z: 6(近) ~ -54(远)
  const pos = new Float32Array(COUNT * 3);
  const attr = new Float32Array(COUNT * 4);   // size, hue(0银1蓝2白), speed, phase
  for (let i = 0; i < COUNT; i++) {
    const x = (seeds() - 0.5) * 46;
    const y = (seeds() - 0.5) * 30;
    const z = 6 - seeds() * DEPTH;
    pos.set([x, y, z], i * 3);
    const depth = (6 - z) / DEPTH;             // 0近 1远
    attr.set([
      2.2 + seeds() * 3.0 * (1 - depth * 0.6), // 近处点大
      seeds() < 0.12 ? 2 : (seeds() < 0.6 ? 1 : 0),
      0.6 + seeds() * 1.8 * (1 - depth * 0.5), // 近处流得快
      seeds() * 6.2831,
    ], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAttr', new THREE.BufferAttribute(attr, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -24), 70); // 免逐帧算包围盒

  const uni = { uTime: { value: 0 }, uDpr: { value: Math.min(devicePixelRatio, DPR_CAP) }, uPulse: { value: -1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime; uniform float uDpr; uniform float uPulse;
      attribute vec4 aAttr;
      varying float vHue; varying float vTw; varying float vPulse;
      void main() {
        vec3 p = position;
        float h = mod(p.y + uTime * aAttr.z * 2.4 + 15.0, 30.0) - 15.0;  // 数据流下落，取模循环
        p.y = h;
        p.x += sin(uTime * 0.35 + aAttr.w) * 0.6;                        // 轻微横向漂移
        vHue = aAttr.y;
        vTw = 0.72 + 0.28 * sin(uTime * (1.1 + fract(aAttr.w) * 2.0) + aAttr.w * 7.0);
        // 故障脉冲：一条沿 y 扫过的亮带（uPulse 在 0~1 区间时激活）
        vPulse = (uPulse >= 0.0 && uPulse <= 1.0)
          ? smoothstep(0.06, 0.0, abs(p.y / 15.0 - (uPulse * 2.0 - 1.0))) : 0.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aAttr.x * uDpr * (18.0 / -mv.z);
      }`,
    fragmentShader: `
      precision mediump float;
      varying float vHue; varying float vTw; varying float vPulse;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        if (max(abs(c.x), abs(c.y)) > 0.5) discard;               // 像素方块，不要圆点
        vec3 silver = vec3(0.78, 0.82, 0.95);
        vec3 blue   = vec3(0.31, 0.49, 1.0);
        vec3 white  = vec3(0.95, 0.97, 1.0);
        vec3 col = vHue < 0.5 ? silver : (vHue < 1.5 ? blue : white);
        float a = 0.55 * vTw + vPulse * 0.85;
        col = mix(col, vec3(1.0, 0.45, 0.85), vPulse * 0.55);     // 脉冲带闪粉紫
        gl_FragColor = vec4(col, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  // ---- 尺寸：canvas 填满 hero，竖屏加宽垂直 FOV（webgl-craft 渲染纪律）----
  function resize() {
    const w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const portrait = h > w;
    camera.fov = portrait ? 56 : 45;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  // ---- 鼠标视差：稳态滞后 = speed/k 的算术，修正并入目标再滤波 ----
  const target = new THREE.Vector2(0, 0);
  const cam = new THREE.Vector2(0, 0);
  if (matchMedia('(hover: hover)').matches) {
    addEventListener('pointermove', (e) => {
      target.set((e.clientX / innerWidth - 0.5) * 2.4, (e.clientY / innerHeight - 0.5) * -1.4);
    }, { passive: true });
  }

  // ---- 帧循环：时间只从 rAF 取；隐藏页停循环；reduced-motion 渲一帧即停 ----
  const clock = { last: null, frames: 0, acc: 0, max: 0 };
  let running = false;
  let pulseAt = 2.8;   // 下一次故障脉冲的时间点（秒）

  function frame(nowMs) {
    const now = nowMs * 0.001;
    const dt = clock.last === null ? 0.016 : Math.min(now - clock.last, 0.1); // 首帧非 0（3dviz 冻结病），tab 切回不爆走
    clock.last = now;

    uni.uTime.value = now;
    // 手感：指数趋近，k=6 —— lag = 1/6 s，算术稳定
    cam.x += (target.x - cam.x) * Math.min(1, dt * 6);
    cam.y += (target.y - cam.y) * Math.min(1, dt * 6);
    camera.position.x = cam.x;
    camera.position.y = cam.y * 0.6;
    camera.lookAt(0, 0, -20);

    // 定时放一条故障脉冲
    if (now >= pulseAt) { uni.uPulse.value = 0; pulseAt = now + 4 + Math.random() * 6; }
    if (uni.uPulse.value >= 0) { uni.uPulse.value += dt * 0.9; if (uni.uPulse.value > 1) uni.uPulse.value = -1; }

    renderer.render(scene, camera);
    clock.frames++; clock.acc += dt; clock.max = Math.max(clock.max, dt);

    if (running && !document.hidden && !reduceMotion && !still) requestAnimationFrame(frame);
  }

  // ---- 调试钩子（webgl-craft 验证纪律）----
  window.G = {
    step(n = 60) { const t0 = uni.uTime.value; for (let i = 0; i < n; i++) frame((t0 + (i + 1) / 60) * 1000); return `advanced ${n} frames, dt=${(1 / 60).toFixed(3)}`; },
    report() {
      const info = renderer.info;
      const avg = clock.frames ? (clock.acc / clock.frames * 1000).toFixed(2) : 'n/a';
      return { drawCalls: info.render.calls, triangles: info.render.triangles, points: COUNT,
               avgFrameMs: avg, worstFrameMs: (clock.max * 1000).toFixed(2), dpr: renderer.getPixelRatio(),
               quality, reduceMotion, still, hidden: document.hidden };
    },
  };

  // 页面隐藏时 rAF 自然节流，但 visibilitychange 恢复时确保循环接上
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running && !reduceMotion && !still) { clock.last = null; requestAnimationFrame(frame); }
  });

  running = true;
  requestAnimationFrame(frame);      // 首帧真实渲染
  if (reduceMotion || still) { /* 只渲染单帧，循环里自停 */ }

  canvas.classList.add('is-on');     // CSS 淡入（一属性一驱动者：opacity 只归 CSS）
  setTimeout(() => { if (clock.frames === 0) fail('no frame rendered'); }, 3000);

  function fail(e) { console.warn('[hero-gl] disabled:', e); canvas.remove(); }
}
