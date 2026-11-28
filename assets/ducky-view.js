// ducky-view.js — Q 版手办展示：懒加载 + 拖转 + 惯性（webgl-craft 纪律 v2）
// 渐进增强：模型加载失败 → 移除 canvas 留占位文案。调试：?still=1 静帧 | window.GD.report()
import * as THREE from 'three';

const stage = document.getElementById('ducky-stage');
const canvas = document.getElementById('ducky-gl');
const note = stage?.querySelector('.ducky-note');
if (!stage || !canvas || !note) { /* 未接线，安静退出 */ }
else boot();

function boot() {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = new URLSearchParams(location.search).has('still');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (e) { return fail(e); }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // 不开它白团子必糊死白（11-28 过曝事故）
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);

  // PBR 材质没环境光就是黑的——RoomEnvironment 现场生成 IBL，不下载 HDR
  (async () => {
    try {
      const { RoomEnvironment } = await import('./RoomEnvironment.js');
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch (e) { console.warn('[ducky] IBL fallback:', e); }
  })();

  const root = new THREE.Group();
  scene.add(root);
  root.rotation.y = Math.PI;   // 朝向修正：源模型背对镜头（01:22 定的结论），验收时再微调

  // ---- 尺寸 ----
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  // ---- 拖转 + 惯性 + 闲置自转 ----
  const rot = { cur: 0, vel: 0, target: 0 };
  let dragging = false, lastX = 0, idleSince = 0, moved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; moved = 0; rot.vel = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX; lastX = e.clientX;
    rot.target += dx * 0.011;
    rot.vel = dx * 0.011; moved += Math.abs(dx);
  });
  const endDrag = () => { if (dragging) { dragging = false; idleSince = performance.now(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- 帧循环（时间只从 rAF 取；隐藏页自停自恢复）----
  const clock = { last: null, frames: 0, acc: 0 };
  let running = false;
  function frame(nowMs) {
    const now = nowMs * 0.001;
    const dt = clock.last === null ? 0.016 : Math.min(now - clock.last, 0.1);
    clock.last = now;

    if (!dragging) {
      rot.target += rot.vel;                 // 惯性
      rot.vel *= Math.pow(0.04, dt);         // 指数衰减，帧率无关
      const idle = reduceMotion || still ? Infinity : now * 1000 - idleSince;
      if (idle > 3000) rot.target += dt * 0.25;   // 闲置 3 秒慢自转
    }
    rot.cur += (rot.target - rot.cur) * Math.min(1, dt * 10);
    root.rotation.y = Math.PI + rot.cur;

    renderer.render(scene, camera);
    clock.frames++; clock.acc += dt;
    if (running && !document.hidden && !still) requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running && !still) { clock.last = null; requestAnimationFrame(frame); }
  });

  window.GD = {
    report() {
      return { frames: clock.frames, avgFrameMs: clock.frames ? (clock.acc / clock.frames * 1000).toFixed(2) : 'n/a',
               dpr: renderer.getPixelRatio(), rotY: (root.rotation.y - Math.PI).toFixed(2),
               drawCalls: renderer.info.render.calls, still, reduceMotion };
    },
  };

  // ---- 懒加载：滚近了才拉 loader + GLB ----
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((en) => en.isIntersecting)) return;
    io.disconnect();
    load();
  }, { rootMargin: '300px' });
  io.observe(stage);

  async function load() {
    try {
      note.textContent = '本体加载中——第一次来要拉 3.4MB，稍等。';
      const { GLTFLoader } = await import('./GLTFLoader.js');
      const gltf = await new Promise((res, rej) => {
        new GLTFLoader().load('./assets/ducky.glb', res,
          (ev) => { if (ev.total) note.textContent = `本体加载中 ${(ev.loaded / ev.total * 100) | 0}%`; },
          rej);
      });

      const model = gltf.scene;
      // 居中 + 归一化：包围盒减中心，缩到固定半径，换模型不改手感
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
      model.position.sub(center);
      const fit = 1.6 / radius;
      model.scale.setScalar(fit);
      root.add(model);

      // 相机站位：按包围球算距离，整只入画
      camera.position.set(0, 0.25, radius * fit / Math.sin((camera.fov * Math.PI / 180) / 2) * 0.62);
      camera.lookAt(0, 0, 0);

      note.textContent = '拖一拖，她会转。';
      if (!running) {
        running = true;
        requestAnimationFrame(frame);
        if (still) { /* 单帧自停 */ }
        canvas.classList.add('is-on');
      }
    } catch (e) { fail(e); }
  }

  function fail(e) {
    console.warn('[ducky] disabled:', e);
    canvas.remove();
    note.textContent = '加载失败——本体还在手机里睡觉，回头再试。';
  }
}
