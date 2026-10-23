// RB World's picture: how a frame is drawn, the sky's clouds, the weather and photo mode.
//   - The frame: the scene in HDR with multisampling, ambient occlusion (GTAO: contact shadows where walls meet the
//     street, under cars and in window recesses), bloom from real light sources only, then tone mapping (AgX) and a
//     grade (contrast, saturation, vignette, a little film grain, lens fringing at the edges, and a speed blur when
//     you're flat out or on nitro).
//   - Quality: Ultra, High, Medium or Low (Settings > Graphics), or Auto, which starts at High on computers and Medium
//     on phones and steps down (or back up) to keep the game smooth. ?hq fixes Ultra.
//   - Clouds: a layer of moving clouds lit by the sun (golden at sunset, dark at night with the city's glow under them).
//   - Weather: clear, cloudy or rain, changing on its own every few minutes (Settings > Weather can fix it). Rain falls
//     round the camera, and the roads and sidewalks get wet: darker, glossy, with puddles that mirror the sky and the
//     lights, drying slowly after.
//   - Photo mode (P or 📷): the game holds still, the HUD hides, you orbit the car, set the focus blur and a filter,
//     and save the picture.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";

export const TIERS = {
  ultra: { name: "Ultra", ratio: 2, msaa: 4, ao: 1, shadow: 4096, bloom: true, grade: true, clouds: true, rain: 3200 },
  high: { name: "High", ratio: 1.5, msaa: 4, ao: 0.5, shadow: 2048, bloom: true, grade: true, clouds: true, rain: 2200 },
  medium: { name: "Medium", ratio: 1, msaa: 2, ao: 0, shadow: 1024, bloom: true, grade: true, clouds: true, rain: 1200 },
  low: { name: "Low", ratio: 0.75, msaa: 0, ao: 0, shadow: 0, bloom: false, grade: false, clouds: false, rain: 500 },
};
const ORDER = ["low", "medium", "high", "ultra"];
const SAVE = "rb_gfx_v1";
const FILTERS = { none: { sat: 1.12, con: 1.06, tint: [1, 1, 1] }, warm: { sat: 1.2, con: 1.08, tint: [1.08, 1.0, 0.88] }, cool: { sat: 1.05, con: 1.08, tint: [0.9, 0.98, 1.1] }, noir: { sat: 0, con: 1.25, tint: [1, 1, 1] }, vivid: { sat: 1.45, con: 1.12, tint: [1, 1, 1] } };

// ---------------------------------------------------------------- the grade (after tone mapping, in display colours)
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uSat: { value: 1.12 }, uCon: { value: 1.06 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uVig: { value: 0.32 }, uGrain: { value: 0.022 }, uCA: { value: 0.0022 }, uSpeed: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uSat, uCon, uVig, uGrain, uCA, uSpeed; uniform vec2 uRes; uniform vec3 uTint; varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5; float d = length(c);
      vec3 col;
      if (uSpeed > 0.002) { // a radial speed blur, strongest at the edges, none in the middle
        float k = uSpeed * smoothstep(0.12, 0.75, d) * 0.07; col = vec3(0.0);
        for (int i = 0; i < 8; i++) col += texture2D(tDiffuse, 0.5 + c * (1.0 - k * float(i) / 7.0)).rgb;
        col /= 8.0;
      } else col = texture2D(tDiffuse, vUv).rgb;
      float ca = uCA * d * d * 4.0; // lens fringing towards the corners
      col.r = mix(col.r, texture2D(tDiffuse, vUv + c * ca).r, 0.7); col.b = mix(col.b, texture2D(tDiffuse, vUv - c * ca).b, 0.7);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uCon + 0.5;
      col *= uTint;
      col *= mix(1.0, smoothstep(0.95, 0.22, d), uVig);
      float n = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

// ---------------------------------------------------------------- clouds
const NOISE = `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; mat2 r = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 6; i++) { v += a * vnoise(p); p = r * p; a *= 0.5; } return v; }`;
function cloudLayer() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uCover: { value: 0.35 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.6, 0.65, 0.75) }, uCam: { value: new THREE.Vector3() }, uDark: { value: 0 } },
    vertexShader: "varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `
      uniform float uTime, uCover, uDark; uniform vec3 uSun, uCam, uSunCol, uAmb; varying vec3 vW;
      ${NOISE}
      void main() {
        vec2 p = vW.xz * 0.00042 + vec2(uTime * 0.004, uTime * 0.0016);
        float n = fbm(p), edge = 1.0 - uCover;
        float dens = smoothstep(edge, edge + 0.32, n);
        if (dens < 0.01) discard;
        // light: how much cloud lies between this point and the sun (a step towards it)
        float toward = fbm(p + normalize(uSun.xz + 1e-4) * 0.06 * max(0.2, 1.0 - uSun.y));
        float lit = clamp(1.0 - (toward - n) * 3.5 - dens * 0.35, 0.15, 1.0);
        vec3 col = mix(uAmb * 0.55, uSunCol, lit);
        col = mix(col, uAmb * 0.7, uCover * 0.5); // heavy cloud is greyer
        col += vec3(0.32, 0.2, 0.1) * uDark * dens; // the city's glow under the clouds at night
        float dist = length(vW.xz - uCam.xz);
        float a = dens * (1.0 - smoothstep(2600.0, 7800.0, dist)) * mix(0.92, 1.0, uCover);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = 1100; m.renderOrder = -1; m.frustumCulled = false; m.userData.noAO = true;
  return m;
}

// ---------------------------------------------------------------- rain: streaks round the camera, fixed in the world
function rainLayer(count) {
  const B = new THREE.Vector3(110, 55, 110), pos = new Float32Array(count * 6), end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { const x = Math.random() * B.x, y = Math.random() * B.y, z = Math.random() * B.z; pos.set([x, y, z, x, y, z], i * 6); end.set([0, 1], i * 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uB: { value: B }, uRain: { value: 0 }, uCol: { value: new THREE.Color(0.75, 0.8, 0.9) } },
    vertexShader: `
      uniform float uTime; uniform vec3 uCam, uB; attribute float aEnd; varying float vA;
      void main() {
        vec3 p = position;
        float sp = 26.0 + 10.0 * fract(p.x * 7.13 + p.z * 3.1);
        p.y = mod(p.y - uTime * sp, uB.y);
        vec3 w = p + uB * floor((uCam - p) / uB + 0.5); // the nearest copy of this drop to the camera
        w.y = uCam.y - uB.y * 0.35 + p.y;
        w += aEnd * vec3(0.18, -0.9, 0.06) * (sp / 30.0);
        vA = 1.0 - smoothstep(18.0, 52.0, length(w - uCam));
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: "uniform float uRain; uniform vec3 uCol; varying float vA; void main() { gl_FragColor = vec4(uCol, 0.32 * uRain * vA); }",
  });
  const m = new THREE.LineSegments(g, mat); m.frustumCulled = false; m.visible = false;
  return m;
}

// ---------------------------------------------------------------- start
export function initFx({ renderer, scene, camera, wet }) {
  const mobile = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 600;
  const fixed = /[?&]hq\b/.test(location.search);
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(SAVE) || "{}"); } catch (e) {}
  const prefs = { graphics: fixed ? "ultra" : saved.graphics || "auto", weather: saved.weather || "auto" };
  const ceiling = mobile ? "medium" : "high";
  let tierKey = prefs.graphics === "auto" ? ceiling : prefs.graphics, tier = TIERS[tierKey];
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const fx = { exposure: 1, tier: () => tierKey, prefs, weather: { cloud: 0.3, rain: 0, wet: 0, mode: "clear" }, onTier: [], speed: 0, photo: null, filter: "none" };

  const clouds = cloudLayer(); scene.add(clouds);
  let rain = null;

  // ---------------------------------------------------------------- the chain
  let composer = null, passes = {};
  function build() {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); for (const p of composer.passes) if (p.dispose) p.dispose(); }
    composer = null; passes = {};
    const pr = Math.min(window.devicePixelRatio || 1, tier.ratio);
    renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
    if (tier.bloom || tier.ao || tier.grade) {
      const rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? tier.msaa : 0 });
      composer = new EffectComposer(renderer, rt); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
      composer.addPass(new RenderPass(scene, camera));
      if (tier.ao) {
        const ao = new GTAOPass(scene, camera, innerWidth * pr * tier.ao, innerHeight * pr * tier.ao);
        ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = 0.85;
        ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: tier.ao >= 1 ? 16 : 10, distanceFallOff: 1, screenSpaceRadius: false });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
        const set = ao.setSize.bind(ao); ao.setSize = (w, h) => set(w * tier.ao, h * tier.ao); // half resolution on High
        const ov = ao.overrideVisibility.bind(ao); ao.overrideVisibility = () => { ov(); scene.traverse((o) => { if (o.userData.noAO) o.visible = false; }); };
        composer.addPass(ao); passes.ao = ao;
      }
      passes.bokeh = new BokehPass(scene, camera, { focus: 20, aperture: 0.0002, maxblur: 0.012 }); passes.bokeh.enabled = false; composer.addPass(passes.bokeh);
      if (tier.bloom) { passes.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.32, 2.2); composer.addPass(passes.bloom); } // only real light sources (lamps, signs, lights) pass the threshold
      composer.addPass(new OutputPass());
      if (tier.grade) { passes.grade = new ShaderPass(GradeShader); passes.grade.uniforms.uRes.value.set(innerWidth * pr, innerHeight * pr); composer.addPass(passes.grade); }
    }
    clouds.visible = tier.clouds;
    if (rain) { scene.remove(rain); rain.geometry.dispose(); }
    rain = rainLayer(tier.rain); scene.add(rain);
    for (const cb of fx.onTier) cb(tier);
    applyFilter();
  }
  function setTier(key) {
    if (!TIERS[key] || key === tierKey) return;
    tierKey = key; tier = TIERS[key]; build();
  }
  fx.setGraphics = (choice) => { prefs.graphics = choice; keep(); setTier(choice === "auto" ? ceiling : choice); };
  fx.setWeather = (choice) => { prefs.weather = choice; keep(); nextWeather(); };
  function keep() { try { localStorage.setItem(SAVE, JSON.stringify(prefs)); } catch (e) {} }
  fx.setSize = () => { const pr = renderer.getPixelRatio(); renderer.setSize(innerWidth, innerHeight); if (composer) { composer.setSize(innerWidth, innerHeight); if (passes.grade) passes.grade.uniforms.uRes.value.set(innerWidth * pr, innerHeight * pr); } };

  // Auto: measure the frame rate every 3 seconds; step down below 30 fps, back up (to the starting level) above 57
  let aT = 0, aN = 0, calm = 0, cool = 0;
  function auto(dt) {
    if (prefs.graphics !== "auto" || fixed || fx.photo) return;
    aT += dt; aN++; cool -= dt; if (aT < 3) return;
    const fps = aN / aT; aT = 0; aN = 0;
    const i = ORDER.indexOf(tierKey);
    if (fps < 30 && i > 0 && cool <= 0) { setTier(ORDER[i - 1]); cool = 6; calm = 0; }
    else if (fps > 57 && ORDER[i] !== ceiling) { if (++calm >= 3) { setTier(ORDER[i + 1]); calm = 0; cool = 6; } }
    else calm = 0;
  }

  // ---------------------------------------------------------------- weather
  const target = { cloud: 0.3, rain: 0 };
  let wT = 0;
  function nextWeather() {
    let mode = prefs.weather;
    if (mode === "auto") { const r = Math.random(); mode = r < 0.5 ? "clear" : r < 0.78 ? "cloudy" : "rain"; }
    fx.weather.mode = mode;
    Object.assign(target, { clear: { cloud: 0.22, rain: 0 }, cloudy: { cloud: 0.62, rain: 0 }, rain: { cloud: 0.9, rain: 1 } }[mode]);
    wT = 240 + Math.random() * 300;
  }
  nextWeather();
  function weatherTick(dt) {
    wT -= dt; if (wT <= 0) nextWeather();
    const w = fx.weather, k = Math.min(1, dt / 25);
    w.cloud += (target.cloud - w.cloud) * k;
    w.rain += (target.rain - w.rain) * Math.min(1, dt / (target.rain > w.rain ? 18 : 10));
    w.wet = Math.max(0, Math.min(1, w.wet + (w.rain > 0.3 ? dt / 20 : -dt / 120)));
    if (wet) wet.value = w.wet;
    if (rain) { rain.visible = w.rain > 0.02; rain.material.uniforms.uRain.value = w.rain; }
    clouds.material.uniforms.uCover.value = 0.18 + w.cloud * 0.62;
  }
  // the sun and sky for the clouds (from the day and night cycle)
  fx.light = (dir, sunUp, sunCol, amb) => {
    const u = clouds.material.uniforms; u.uSun.value.copy(dir); u.uSunCol.value.copy(sunCol); u.uAmb.value.copy(amb); u.uDark.value = Math.max(0, 1 - sunUp * 3);
  };

  // ---------------------------------------------------------------- photo mode
  function applyFilter() {
    if (!passes.grade) return;
    const f = FILTERS[fx.filter] || FILTERS.none, u = passes.grade.uniforms;
    u.uSat.value = f.sat; u.uCon.value = f.con; u.uTint.value.set(...f.tint);
    u.uVig.value = fx.photo ? 0.45 : 0.32; u.uGrain.value = fx.photo ? 0.012 : 0.022;
  }
  fx.setFilter = (k) => { fx.filter = k; applyFilter(); };
  fx.setPhoto = (on, focusOf) => {
    fx.photo = on ? { focusOf, blur: 0.5 } : null;
    if (passes.bokeh) passes.bokeh.enabled = !!on;
    if (!on) fx.filter = "none";
    applyFilter();
  };
  fx.setBlur = (v) => { if (fx.photo) fx.photo.blur = v; };
  fx.snap = () => new Promise((res) => { draw(0); renderer.domElement.toBlob((b) => res(b), "image/png"); });

  // ---------------------------------------------------------------- a frame
  let time = 0;
  function draw(dt) {
    time += dt;
    clouds.position.set(camera.position.x, 1100, camera.position.z);
    const cu = clouds.material.uniforms; cu.uTime.value = time; cu.uCam.value.copy(camera.position);
    if (rain) { rain.material.uniforms.uTime.value = time; rain.material.uniforms.uCam.value.copy(camera.position); }
    if (passes.grade) { const g = passes.grade.uniforms; g.uTime.value = time; g.uSpeed.value += (fx.speed - g.uSpeed.value) * Math.min(1, dt * 4); }
    if (passes.bokeh && fx.photo) { const u = passes.bokeh.uniforms; const f = fx.photo.focusOf ? fx.photo.focusOf() : 20; u.focus.value = f; u.aperture.value = 0.000005 + fx.photo.blur * 0.00025; u.maxblur.value = 0.002 + fx.photo.blur * 0.01; }
    if (composer) composer.render(dt); else renderer.render(scene, camera);
  }
  fx.frames = 0;
  fx.render = (dt) => { weatherTick(dt); auto(dt); draw(dt); fx.frames++; };
  fx.build = () => build();
  fx.passes = () => passes;
  window.addEventListener("resize", () => fx.setSize());
  return fx;
}
