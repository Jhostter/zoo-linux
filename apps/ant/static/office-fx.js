// Estilos visuales de la oficina 3D.
//  · voxel  — el original: render directo (sin postproceso).
//  · toon   — cel-shading: luz escalonada + contornos dibujados a partir de la profundidad (bordes y pliegues).
//  · cyber  — cyberpunk: neón, luces de colores, suelo mojado, bloom y gradación de color.
// La geometría y los personajes son los mismos en todos: solo cambian la iluminación, los materiales sueltos y el postproceso.
export const STYLES = ["voxel", "toon", "cyber"];
export const STYLE_INFO = {
  voxel: { name: "Voxel", desc: "El original: bloques tipo Minecraft, luz suave y sombras." },
  toon: { name: "Toon", desc: "Cel-shading: colores planos en escalones y contorno negro de cómic." },
  cyber: { name: "Cyberpunk", desc: "Neón magenta y cian, suelo mojado, brillo (bloom) y grano de película." },
};

const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const TOON = `
precision highp float; varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 texel; uniform float near; uniform float far; uniform float steps; uniform float edge; uniform float width;
float invz(vec2 uv){ float d = texture2D(tDepth, uv).x; return ((far - near) * d - far) / (near * far); } // 1/z de vista: lineal en pantalla para los planos
void main(){
  vec4 c = texture2D(tColor, vUv); vec2 o = texel * width;
  float z0 = invz(vUv), zl = invz(vUv - vec2(o.x, 0.0)), zr = invz(vUv + vec2(o.x, 0.0)), zu = invz(vUv + vec2(0.0, o.y)), zd = invz(vUv - vec2(0.0, o.y));
  float lap = abs(zl + zr + zu + zd - 4.0 * z0) / max(1e-4, abs(z0)); // un plano da 0; un borde o un pliegue da un pico
  float e = smoothstep(edge, edge * 2.4, lap);
  vec3 col = c.rgb * 1.3 + 0.035; float lum = dot(col, vec3(0.2126, 0.7152, 0.0722)); // se levantan las sombras: un dibujo animado no tiene negros
  float p = sqrt(max(lum, 0.0)); float lq = pow(floor(p * steps + 0.5) / steps, 2.0); // escalones de luz perceptuales
  col *= (lq + 0.03) / (lum + 0.03);
  float g = dot(col, vec3(0.333)); col = mix(vec3(g), col, 1.45); // colores más vivos, de dibujo animado
  col = mix(col, vec3(0.015, 0.01, 0.03), e * 0.95);
  gl_FragColor = linearToOutputTexel(vec4(col, max(c.a, e)));
}`;
const BRIGHT = `precision highp float; varying vec2 vUv; uniform sampler2D tColor; uniform float thr;
void main(){ vec3 c = texture2D(tColor, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(c * smoothstep(thr, thr + 0.7, l), 1.0); }`;
const BLUR = `precision highp float; varying vec2 vUv; uniform sampler2D tColor; uniform vec2 dir;
void main(){ vec3 s = texture2D(tColor, vUv).rgb * 0.2270270270; s += (texture2D(tColor, vUv + dir * 1.3846153846).rgb + texture2D(tColor, vUv - dir * 1.3846153846).rgb) * 0.3162162162;
  s += (texture2D(tColor, vUv + dir * 3.2307692308).rgb + texture2D(tColor, vUv - dir * 3.2307692308).rgb) * 0.0702702703; gl_FragColor = vec4(s, 1.0); }`;
const CYBER = `
precision highp float; varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tA; uniform sampler2D tB; uniform vec2 res; uniform float time; uniform float strength;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv, d = uv - 0.5; float ab = dot(d, d) * 0.014; // aberración cromática hacia los bordes
  vec3 col; col.r = texture2D(tColor, uv + d * ab).r; col.g = texture2D(tColor, uv).g; col.b = texture2D(tColor, uv - d * ab).b; float a = texture2D(tColor, uv).a;
  vec3 bloom = texture2D(tA, uv).rgb * 0.85 + texture2D(tB, uv).rgb * 1.35; col += bloom * strength;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col * vec3(0.7, 0.78, 1.28), col * vec3(1.12, 0.94, 1.06), smoothstep(0.08, 0.9, lum)); // sombras azul-violeta, luces cálidas-magenta
  col += vec3(0.018, 0.0, 0.05) * (1.0 - clamp(lum, 0.0, 1.0));
  col *= 0.95 + 0.05 * sin(uv.y * res.y * 3.14159); col *= 1.0 - dot(d, d) * 0.85; col += (hash(uv * res + time) - 0.5) * 0.022; // scanlines, viñeta, grano
  col = col / (1.0 + col * 0.32) * 1.38;
  gl_FragColor = linearToOutputTexel(vec4(col, max(a, clamp(dot(bloom, vec3(0.333)) * strength, 0.0, 1.0))));
}`;

export function createFx(THREE, env) {
  const { renderer, scene, camera, hemi, sun } = env;
  let style = "voxel", size = { w: 0, h: 0 }, T = null, cyber = null; const snap = {}, _v = new THREE.Vector2();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), qScene = new THREE.Scene(), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); qScene.add(quad); quad.frustumCulled = false;
  const mkPass = (frag, uni) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms: Object.fromEntries(Object.entries(uni).map(([k, v]) => [k, { value: v }])), depthTest: false, depthWrite: false });
  const mats = {
    toon: mkPass(TOON, { tColor: null, tDepth: null, texel: new THREE.Vector2(), near: 0.5, far: 300, steps: 4, edge: 0.00012, width: 1.6 }),
    bright: mkPass(BRIGHT, { tColor: null, thr: 1.0 }), blur: mkPass(BLUR, { tColor: null, dir: new THREE.Vector2() }),
    cyber: mkPass(CYBER, { tColor: null, tA: null, tB: null, res: new THREE.Vector2(), time: 0, strength: 0.85 }),
  };
  const halfOk = () => renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
  function targets() { // se recrean solo cuando cambia el tamaño del lienzo
    renderer.getDrawingBufferSize(_v); const w = Math.max(2, _v.x | 0), h = Math.max(2, _v.y | 0); if (T && size.w === w && size.h === h) return T;
    if (T) { T.scene.depthTexture.dispose(); Object.values(T).forEach((t) => t.dispose()); } size = { w, h };
    const type = halfOk() ? THREE.HalfFloatType : THREE.UnsignedByteType, depth = new THREE.DepthTexture(w, h); depth.type = THREE.UnsignedIntType;
    const rt = (ww, hh) => new THREE.WebGLRenderTarget(Math.max(2, ww >> 0), Math.max(2, hh >> 0), { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    T = { scene: new THREE.WebGLRenderTarget(w, h, { type, samples: 4, depthBuffer: true, depthTexture: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }), a: rt(w >> 1, h >> 1), b: rt(w >> 1, h >> 1), c: rt(w >> 2, h >> 2), d: rt(w >> 2, h >> 2) };
    return T;
  }
  function pass(m, uni, target, texW, texH) {
    for (const k in uni) m.uniforms[k].value = uni[k]; if (m.uniforms.texel) m.uniforms.texel.value.set(1 / texW, 1 / texH); quad.material = m; renderer.setRenderTarget(target); renderer.render(qScene, qCam);
  }
  const blur = (src, dst, w, h, dx, dy, k = 1) => pass(mats.blur, { tColor: src.texture, dir: new THREE.Vector2((dx * k) / w, (dy * k) / h) }, dst);

  // ---------- cyberpunk: neón, luces de color, suelo mojado y polvo luminoso (se crea la primera vez que se usa)
  function buildCyber() {
    const g = new THREE.Group(); g.visible = false; scene.add(g); const neons = [];
    const neon = (w, h, d, col, x, y, z, k = 3) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: "#000000", emissive: col, emissiveIntensity: k, roughness: 0.4 })); m.position.set(x, y, z); g.add(m); neons.push(m); return m; };
    neon(16.2, 0.05, 0.07, "#ff2bd6", 0, 0.03, -6.5); neon(0.07, 0.05, 13.2, "#26e5ff", -8.0, 0.03, 0); neon(16.2, 0.05, 0.07, "#26e5ff", 0, 0.03, 6.55); neon(0.07, 0.05, 13.2, "#ff2bd6", 8.0, 0.03, 0);
    (env.stations() || []).forEach((st, i) => neon(2.0, 0.04, 0.05, i % 2 ? "#26e5ff" : "#ff2bd6", st.x, 0.14, st.deskZ + 0.52, 2.6)); // luz bajo cada mesa
    const frame = (cx, cy, w, h, col) => { neon(w, 0.06, 0.06, col, cx, cy + h / 2, -6.55); neon(w, 0.06, 0.06, col, cx, cy - h / 2, -6.55); neon(0.06, h, 0.06, col, cx - w / 2, cy, -6.55); neon(0.06, h, 0.06, col, cx + w / 2, cy, -6.55); };
    frame(-5.0, 1.75, 4.75, 2.6, "#ff2bd6"); frame(3.7, 2.45, 6.9, 2.9, "#26e5ff");
    const L1 = new THREE.PointLight("#ff2bd6", 34, 22, 1.5), L2 = new THREE.PointLight("#26e5ff", 28, 22, 1.5); L1.position.set(-6, 3.4, -3.5); L2.position.set(6.5, 3.4, 3); g.add(L1, L2);
    const n = 200, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), seed = Float32Array.from({ length: n }, Math.random);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = Math.random() * 4.2; pos[i * 3 + 2] = (Math.random() - 0.5) * 13; const c = new THREE.Color(i % 2 ? "#ff2bd6" : "#26e5ff"); col.set([c.r, c.g, c.b], i * 3); }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, map: env.dot }));
    dust.frustumCulled = false; g.add(dust); cyber = { g, neons, L1, L2, dust, pos, seed };
  }
  function enter(s) {
    if (s === "toon") { snap.bg = scene.background; if (scene.background) scene.background = new THREE.Color("#2e3d6e"); }
    if (s === "cyber") {
      if (!cyber) buildCyber(); snap.bg = scene.background; snap.fog = scene.fog; snap.hemi = [hemi.color.getHex(), hemi.groundColor.getHex()]; const fl = env.floor(); if (fl) snap.floor = [fl.roughness, fl.metalness];
      if (scene.background) scene.background = new THREE.Color("#07030f"); scene.fog = new THREE.FogExp2("#12061f", 0.016); hemi.color.set("#5a3fa8"); hemi.groundColor.set("#14081f"); cyber.g.visible = true;
      if (fl) { fl.roughness = 0.26; fl.metalness = 0.4; fl.needsUpdate = true; }
    }
  }
  function leave(s) {
    if (s === "toon" || s === "cyber") { if (snap.bg !== undefined && scene.background) scene.background = snap.bg; }
    if (s === "cyber" && cyber) { cyber.g.visible = false; scene.fog = snap.fog || null; hemi.color.setHex(snap.hemi[0]); hemi.groundColor.setHex(snap.hemi[1]); const fl = env.floor(); if (fl && snap.floor) { fl.roughness = snap.floor[0]; fl.metalness = snap.floor[1]; fl.needsUpdate = true; } }
  }
  function setStyle(name) {
    if (!STYLES.includes(name) || name === style) return false; leave(style); style = name; enter(style); if (env.onStyle) env.onStyle(style); return true;
  }
  // el ciclo día/noche de la oficina pasa por aquí para que cada estilo ajuste la luz a su gusto
  const adjHemi = (v) => (style === "cyber" ? 0.62 : style === "toon" ? v + 0.42 : v), adjSun = (v) => (style === "cyber" ? 0.55 : style === "toon" ? v * 0.9 : v), sunColor = (c) => (style === "cyber" ? "#7fa8ff" : c);
  function update(t) {
    if (style !== "cyber" || !cyber) return; const c = cyber; c.L1.intensity = 34 + Math.sin(t * 1.3) * 5 + (Math.sin(t * 17) > 0.97 ? -20 : 0); c.L2.intensity = 28 + Math.sin(t * 1.7 + 2) * 5;
    c.neons.forEach((m, i) => (m.material.emissiveIntensity = 2.7 + Math.sin(t * 2 + i) * 0.5 + (i % 7 === 0 && Math.sin(t * 9 + i) > 0.92 ? -1.8 : 0)));
    for (let i = 0; i < c.seed.length; i++) { const y = c.pos[i * 3 + 1] + 0.004 + c.seed[i] * 0.006; c.pos[i * 3 + 1] = y > 4.4 ? 0 : y; c.pos[i * 3] += Math.sin(t * 0.5 + i) * 0.0015; } c.dust.geometry.attributes.position.needsUpdate = true;
  }
  function render(t = 0) {
    renderer.info.reset();
    if (style === "voxel") { camera.layers.enableAll(); renderer.render(scene, camera); return; }
    const R = targets(), W = size.w, H = size.h; camera.layers.set(0); renderer.setRenderTarget(R.scene); renderer.clear(); renderer.render(scene, camera);
    mats.toon.uniforms.near.value = camera.near; mats.toon.uniforms.far.value = camera.far;
    if (style === "toon") pass(mats.toon, { tColor: R.scene.texture, tDepth: R.scene.depthTexture }, null, W, H);
    else {
      pass(mats.bright, { tColor: R.scene.texture }, R.a, W / 2, H / 2); blur(R.a, R.b, W / 2, H / 2, 1, 0); blur(R.b, R.a, W / 2, H / 2, 0, 1);
      blur(R.a, R.c, W / 4, H / 4, 1, 0, 1.6); blur(R.c, R.d, W / 4, H / 4, 0, 1, 1.6); blur(R.d, R.c, W / 4, H / 4, 1, 0, 2.6); blur(R.c, R.d, W / 4, H / 4, 0, 1, 2.6);
      pass(mats.cyber, { tColor: R.scene.texture, tA: R.a.texture, tB: R.d.texture, res: new THREE.Vector2(W, H), time: t % 100 }, null, W, H);
    }
    // etiquetas, globos y demás interfaz en la escena: encima del resultado, sin postprocesar (el texto sigue nítido)
    camera.layers.set(1); const auto = renderer.autoClear, sh = renderer.shadowMap.autoUpdate, bg = scene.background, fog = scene.fog;
    renderer.autoClear = false; renderer.shadowMap.autoUpdate = false; scene.background = null; scene.fog = null; // un fondo de color obligaría a borrar lo ya dibujado; la niebla desvanecería las etiquetas
    renderer.setRenderTarget(null); renderer.render(scene, camera);
    renderer.autoClear = auto; renderer.shadowMap.autoUpdate = sh; scene.background = bg; scene.fog = fog; camera.layers.enableAll();
  }
  renderer.info.autoReset = false;
  const tune = (o) => { for (const k in o) { if (k in mats.toon.uniforms) mats.toon.uniforms[k].value = o[k]; if (k === "bloom") mats.cyber.uniforms.strength.value = o[k]; if (k === "thr") mats.bright.uniforms.thr.value = o[k]; } };
  return { tune, STYLES, get style() { return style; }, setStyle, render, update, adjHemi, adjSun, sunColor, resize: () => { if (style !== "voxel") targets(); },
    stats() { renderer.getDrawingBufferSize(_v); return { w: _v.x, h: _v.y, targets: !!T, neon: cyber ? cyber.neons.length : 0 }; } };
}
