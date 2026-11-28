// crt-shot.js — hero 街机图的 CRT shader 层（webgl-craft 纪律 v2）
// 渐进增强：img 是 fallback，canvas 覆盖其上；任何失败移除 canvas 露出原图。
// 调试：?still=1 静帧（glitch 关）| window.GC.report() 计数器
import * as THREE from 'three';

const host = document.querySelector('.hero-shot');
const img = host?.querySelector('img');
if (!host || !img) { /* 没接线，安静退出 */ }
else boot();

function boot() {
  const params = new URLSearchParams(location.search);
  const still = params.has('still');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.createElement('canvas');
  canvas.className = 'crt-gl';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'low-power' });
  } catch (e) { return fail(e); }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uni = {
    uTex: { value: null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },       // 当前 glitch 强度 0~1
    uSeed: { value: 0 },         // 本次 glitch 的随机种子
  };

  const mat = new THREE.ShaderMaterial({
    uniforms: uni,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      precision mediump float;
      uniform sampler2D uTex;
      uniform float uTime; uniform float uGlitch; uniform float uSeed;
      varying vec2 vUv;

      float hash(float n) { return fract(sin(n) * 43758.5453); }

      void main() {
        // CRT 弧面：轻微桶形畸变
        vec2 c = vUv - 0.5;
        vec2 uv = vUv + c * dot(c, c) * 0.12;

        // glitch：随机水平条带撕位移
        float band = step(0.96 - uGlitch * 0.10, hash(floor(uv.y * 24.0) + uSeed));
        uv.x += band * uGlitch * (hash(floor(uv.y * 24.0) + uSeed + 7.0) - 0.5) * 0.08;

        // 出界归黑（弧面边缘）
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.02, 0.01, 0.03, 1.0); return;
        }

        // RGB 色散：三通道水平错位
        float ab = 0.0012 + uGlitch * 0.004;
        float r = texture2D(uTex, uv + vec2(ab, 0.0)).r;
        float g = texture2D(uTex, uv).g;
        float b = texture2D(uTex, uv - vec2(ab, 0.0)).b;
        vec3 col = vec3(r, g, b);

        // 扫描线 + 缓慢滚动的刷新亮带
        col *= 1.0 - 0.09 * sin(uv.y * 640.0);
        float sweep = smoothstep(0.03, 0.0, abs(fract(uv.y * 0.5 + uTime * 0.06) - 0.5) - 0.47);
        col += sweep * 0.035;

        // 噪声颗粒 + 暗角
        col += (hash(uv.x * 91.7 + uv.y * 137.3 + uTime) - 0.5) * 0.03;
        float vig = smoothstep(0.95, 0.45, length(c));
        col *= mix(0.72, 1.0, vig);

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  // 贴图按原图 sRGB 数值直读直写（图像处理链不做色彩空间转换）
  new THREE.TextureLoader().load(img.currentSrc || img.src, (tex) => {
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    uni.uTex.value = tex;
    start();
  }, undefined, () => fail('texture load failed'));

  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
  }
  resize();
  addEventListener('resize', resize);

  // glitch 排程：每 3~7 秒一次，每次 ~0.22s
  let nextGlitch = 2.5 + Math.random() * 3;
  let glitchEnd = -1;
  const clock = { last: null, frames: 0, acc: 0 };
  let running = false;

  function frame(nowMs) {
    const now = nowMs * 0.001;
    const dt = clock.last === null ? 0.016 : Math.min(now - clock.last, 0.1);
    clock.last = now;
    uni.uTime.value = now;

    if (!reduceMotion && !still) {
      if (now >= nextGlitch) {
        uni.uGlitch.value = 1; uni.uSeed.value = Math.random() * 100;
        glitchEnd = now + 0.22; nextGlitch = now + 3 + Math.random() * 4;
      }
      if (glitchEnd > 0 && now < glitchEnd) uni.uGlitch.value = Math.max(0, uni.uGlitch.value - dt * 6);
      else uni.uGlitch.value = 0;
    }

    renderer.render(scene, camera);
    clock.frames++; clock.acc += dt;
    if (running && !document.hidden && !reduceMotion && !still) requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running && !reduceMotion && !still) { clock.last = null; requestAnimationFrame(frame); }
  });

  function start() {
    running = true;
    requestAnimationFrame(frame);
    if (reduceMotion || still) { /* 单帧静态，循环自停 */ }
    canvas.classList.add('is-on');
  }

  window.GC = { report() { return { frames: clock.frames, avgFrameMs: clock.frames ? (clock.acc / clock.frames * 1000).toFixed(2) : 'n/a', dpr: renderer.getPixelRatio(), reduceMotion, still }; } };

  function fail(e) { console.warn('[crt-gl] disabled:', e); canvas.remove(); }
}
