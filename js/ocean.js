// A GPU particle ocean shaped by what people are listening to.
//
// Every frame, listeners are rendered into a small "field" texture covering the water:
// which way it flows (their vortex plus the current of their musical style), how rough
// it is (calm for ambient, choppy for dance), its height, its pigment, and a glow for
// loved tracks. A few hundred thousand particles then drift through that field and a
// curl-noise sea, and are drawn additively into a slowly fading HDR buffer.

export const BOUNDS = { x: 2.8, y: 2.4 }; // world half-extents of the water
export const MAXL = 128; // listeners
export const MAXR = 16;          // ripples alive at once
const FIELD = 256;        // field texture resolution
const OCEAN = [0.05, 0.13, 0.27];

export const COMMON = `
precision highp float;
precision highp int;
uniform float uTime;
uniform vec2 uBounds;
vec2 fuv(vec2 p) { return p / uBounds * 0.5 + 0.5; }
float swell(vec2 p, float t) {
  return 0.085 * sin(dot(p, vec2(0.9, 0.45)) * 2.2 - t * 0.5)
       + 0.050 * sin(dot(p, vec2(-0.35, 1.0)) * 3.9 - t * 0.7)
       + 0.024 * sin(dot(p, vec2(0.7, -0.75)) * 7.3 - t * 1.1)
       + 0.011 * sin(dot(p, vec2(-0.95, -0.2)) * 13.0 - t * 1.6)
       + 0.005 * sin(dot(p, vec2(0.2, 0.98)) * 23.0 - t * 2.3);
}
`;

const FIELD_FS = `#version 300 es
${COMMON}
const int MAXL = ${MAXL};
const int MAXR = ${MAXR};
uniform sampler2D uListeners; // row 0: xy, energy, spin. row 1: rgb, loved. row 2: style current xy, chop, song-start surge
uniform int uCount;
uniform vec4 uR[MAXR];        // ripple: xy, birth time, strength
uniform vec3 uRC[MAXR];
in vec2 vUv;
layout(location = 0) out vec4 oFlow;   // velocity xy, height, spray
layout(location = 1) out vec4 oPaint;  // pigment rgb, weight
layout(location = 2) out vec4 oMood;   // chop, loved glow

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uBounds;
  vec2 vel = vec2(0.0);
  vec3 pig = vec3(0.0);
  float h = swell(p, uTime), mound = 0.0, spray = 0.0, w = 0.0, chop = 0.0, chopW = 0.0, glow = 0.0;

  for (int i = 0; i < MAXL; i++) {
    if (i >= uCount) break;
    vec4 A = texelFetch(uListeners, ivec2(i, 0), 0);
    vec2 d = p - A.xy;
    float r2 = dot(d, d);
    if (r2 > 2.5) continue;
    vec4 B = texelFetch(uListeners, ivec2(i, 1), 0);
    vec4 C = texelFetch(uListeners, ivec2(i, 2), 0);
    float e = A.z + C.w * 0.9;                 // listening energy, plus a surge when a song starts
    float core = exp(-r2 * 18.0);
    vel += A.w * vec2(-d.y, d.x) * e * 0.95 * core - d * e * 0.1 * core;
    float wide = exp(-r2 * 4.0);
    vel += C.xy * wide * (0.05 + 0.06 * A.z);  // the current of their style
    mound += e * exp(-r2 * 14.0);
    spray += e * exp(-r2 * 22.0);
    float cw = (0.2 + A.z) * wide;
    chop += C.z * cw;
    chopW += cw;
    glow += B.w * exp(-r2 * 20.0) * (0.5 + 0.5 * A.z);
    float wi = e * exp(-r2 * 26.0);
    pig += B.rgb * wi;
    w += wi;
  }

  for (int i = 0; i < MAXR; i++) {
    vec4 r = uR[i];
    float a = uTime - r.z;
    if (r.w <= 0.0 || a < 0.0 || a > 8.0) continue;
    vec2 d = p - r.xy;
    float dist = length(d) + 1e-4;
    float b = exp(-pow((dist - a * 0.24) * 16.0, 2.0)) * r.w * (1.0 - a / 8.0);
    vel += d / dist * b * 0.35;
    h += 0.09 * b;
    pig += uRC[i] * b * 3.0;
    w += b * 3.0;
  }

  // Crowds saturate instead of stacking: a hundred listeners make a lively sea, not a mountain.
  h += 0.2 * (1.0 - exp(-mound * 0.8));
  float speed = length(vel);
  if (speed > 0.3) vel *= 0.3 / speed;
  oFlow = vec4(vel, h, 1.0 - exp(-spray));
  oPaint = vec4(w > 0.0 ? pig / w : vec3(0.0), w);
  oMood = vec4(mix(0.5, chop / max(chopW, 1e-4), clamp(chopW * 1.5, 0.0, 1.0)), glow, 0.0, 0.0);
}`;

export const NOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec3 ns = 0.142857142857 * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}


// Divergence-free flow: particles swirl and fold instead of bunching up.
vec2 curl(vec3 q) {
  const float e = 0.02;
  float dy = snoise(q + vec3(0.0, e, 0.0)) - snoise(q - vec3(0.0, e, 0.0));
  float dx = snoise(q + vec3(e, 0.0, 0.0)) - snoise(q - vec3(e, 0.0, 0.0));
  return vec2(dy, -dx) / (2.0 * e);
}
`;

export const FULL_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SIM_FS = `#version 300 es
${COMMON}
uniform sampler2D uPos;  // xy, seed, age
uniform sampler2D uCol;  // pigment
uniform sampler2D uFlow;
uniform sampler2D uPaint;
uniform sampler2D uMood;
uniform float uDt;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oCol;
const vec3 OCEAN = vec3(${OCEAN.join(", ")});

${NOISE}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, ij, 0);
  vec3 col = texelFetch(uCol, ij, 0).rgb;
  vec2 p = P.xy;
  float seed = P.z, age = P.w;
  vec2 uv = fuv(p);
  vec4 flow = texture(uFlow, uv);
  vec4 paint = texture(uPaint, uv);
  float chop = texture(uMood, uv).x;

  // Calm styles make long glassy swirls; energetic ones break the water into fine chop.
  vec2 v = curl(vec3(p * 0.9, uTime * 0.035)) * 0.04 * (0.6 + 0.8 * chop)
         + curl(vec3(p * 2.8 + 7.0, uTime * (0.03 + 0.08 * chop))) * 0.035 * chop
         + vec2(0.01, 0.003)
         + flow.xy;

  p += v * uDt;
  col = mix(col, paint.rgb, clamp(paint.a * uDt * 4.0, 0.0, 1.0));
  col = mix(col, OCEAN, uDt * 0.035);

  age += uDt;
  float life = 10.0 + 14.0 * fract(seed * 7.13);
  if (age > life || abs(p.x) > uBounds.x + 0.1 || abs(p.y) > uBounds.y + 0.1) {
    p = (vec2(hash(vec2(seed, uTime)), hash(vec2(seed * 1.7 + 3.1, uTime))) * 2.0 - 1.0) * uBounds;
    age = 0.0;
    col = OCEAN;
  }
  oPos = vec4(p, seed, age);
  oCol = vec4(col, 1.0);
}`;

const PARTICLE_VS = `#version 300 es
${COMMON}
uniform sampler2D uPos;
uniform sampler2D uCol;
uniform sampler2D uFlow;
uniform sampler2D uMood;
uniform int uTexW;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uPointScale;
out vec3 vCol;
void main() {
  ivec2 ij = ivec2(gl_VertexID % uTexW, gl_VertexID / uTexW);
  vec4 P = texelFetch(uPos, ij, 0);
  vec3 col = texelFetch(uCol, ij, 0).rgb;
  vec2 p = P.xy;
  vec4 flow = texture(uFlow, fuv(p));
  float glow = min(texture(uMood, fuv(p)).y, 1.0);
  const float e = 0.03;
  float h = flow.z;
  vec3 n = normalize(vec3(h - texture(uFlow, fuv(p + vec2(e, 0.0))).z, e, h - texture(uFlow, fuv(p + vec2(0.0, e))).z));

  // About a quarter of the particles are spray, lifted above the surface into
  // swirling columns wherever someone is listening, highest for a loved song.
  float layer = fract(P.z * 13.37);
  float lift = 0.0;
  if (layer > 0.72) {
    float k = (layer - 0.72) / 0.28;
    lift = k * k * (0.015 + 0.14 * flow.w + 0.16 * glow);
  }
  vec3 wp = vec3(p.x, h + lift, p.y);
  gl_Position = uViewProj * vec4(wp, 1.0);
  float dist = length(wp - uEye);
  gl_PointSize = clamp(uPointScale / dist, 1.0, 8.0);

  float life = 10.0 + 14.0 * fract(P.z * 7.13);
  float fade = smoothstep(0.0, 1.5, P.w) * smoothstep(life, life - 2.0, P.w);
  float fog = exp(-max(0.0, dist - 1.4) * 0.5);
  float edge = smoothstep(0.0, 0.6, uBounds.x - abs(p.x)) * smoothstep(0.0, 0.6, uBounds.y - abs(p.y));

  // Moonlight from beyond the horizon: lit slopes, silver glints on the crests.
  vec3 L = normalize(vec3(0.25, 0.55, 1.0));
  vec3 V = normalize(uEye - wp);
  float diff = 0.3 + 0.9 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 18.0);
  float crest = 0.8 + 2.5 * max(h, 0.0);
  vec3 c = col * diff * crest + vec3(0.45, 0.6, 0.95) * spec * 0.45;
  if (lift > 0.0) c = col * (0.9 + lift * 2.5);
  c *= 1.0 + 0.8 * glow; // a loved song makes its patch of sea glow in its own colour
  vCol = c * fade * fog * edge;
}`;

const PARTICLE_FS = `#version 300 es
precision highp float;
uniform float uIntensity;
in vec3 vCol;
out vec4 o;
void main() {
  float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  o = vec4(vCol * a * uIntensity, 1.0);
}`;

const FADE_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTrail;
uniform float uTime;
uniform float uHorizon;
uniform float uExposure;
in vec2 vUv;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(uTrail, vUv).rgb;
  c = 1.0 - exp(-c * uExposure);
  c += vec3(0.006, 0.009, 0.022);
  c += vec3(0.05, 0.08, 0.16) * exp(-abs(vUv.y - uHorizon) * 14.0) * 0.5;
  vec2 q = (vUv - 0.5) * vec2(1.0, 1.25);
  c *= 1.0 - 0.55 * dot(q, q);
  c += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.022;
  o = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

// The same swell as the shader, so labels ride the water.
export function swell(x, y, t) {
  return 0.085 * Math.sin((0.9 * x + 0.45 * y) * 2.2 - t * 0.5)
       + 0.050 * Math.sin((-0.35 * x + y) * 3.9 - t * 0.7)
       + 0.024 * Math.sin((0.7 * x - 0.75 * y) * 7.3 - t * 1.1)
       + 0.011 * Math.sin((-0.95 * x - 0.2 * y) * 13.0 - t * 1.6)
       + 0.005 * Math.sin((0.2 * x + 0.98 * y) * 23.0 - t * 2.3);
}

export class Ocean {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) throw new Error("This needs WebGL2");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("This needs float render targets");
    this.gl = gl;
    this.canvas = canvas;
    this.time = 0;
    this.view = { yaw: 0, el: 0.3, dist: 2.4 };
    this.W = Math.min(innerWidth, innerHeight) < 600 ? 256 : 512;
    this.N = this.W * this.W;
    this.listenerData = new Float32Array(MAXL * 3 * 4);
    this.R = new Float32Array(MAXR * 4);
    this.RC = new Float32Array(MAXR * 3);
    this.count = 0;
    this.mood = { wind: [0, 0], chop: 0.5, activity: 0 };
    this.nextRipple = 0;
    this.vao = gl.createVertexArray();
    this.progs = {
      field: program(gl, FULL_VS, FIELD_FS),
      sim: program(gl, FULL_VS, SIM_FS),
      particles: program(gl, PARTICLE_VS, PARTICLE_FS),
      fade: program(gl, FULL_VS, FADE_FS),
      composite: program(gl, FULL_VS, COMPOSITE_FS),
    };
    this.initState();
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  texture(w, h, internal, type, data, filter) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  framebuffer(...textures) {
    const gl = this.gl, fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Framebuffer incomplete");
    return fb;
  }

  initState() {
    const gl = this.gl, { W, N } = this;
    const pos = new Float32Array(N * 4), col = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      pos.set([(Math.random() * 2 - 1) * BOUNDS.x, (Math.random() * 2 - 1) * BOUNDS.y, Math.random(), Math.random() * 20], i * 4);
      col.set([...OCEAN, 1], i * 4);
    }
    this.pos = [this.texture(W, W, gl.RGBA32F, gl.FLOAT, pos, gl.NEAREST), this.texture(W, W, gl.RGBA32F, gl.FLOAT, null, gl.NEAREST)];
    this.col = [this.texture(W, W, gl.RGBA32F, gl.FLOAT, col, gl.NEAREST), this.texture(W, W, gl.RGBA32F, gl.FLOAT, null, gl.NEAREST)];
    this.simFb = [0, 1].map(i => this.framebuffer(this.pos[i], this.col[i]));
    this.cur = 0;
    this.listeners = this.texture(MAXL, 3, gl.RGBA32F, gl.FLOAT, null, gl.NEAREST);
    this.fields = [0, 1, 2].map(() => this.texture(FIELD, FIELD, gl.RGBA16F, gl.HALF_FLOAT, null, gl.LINEAR));
    this.fieldFb = this.framebuffer(...this.fields);
  }

  resize() {
    const gl = this.gl;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.w = innerWidth;
    this.h = innerHeight;
    // A hidden tab can report no size at all; an empty canvas can't hold a framebuffer.
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
    if (this.trail) { gl.deleteTexture(this.trail); gl.deleteFramebuffer(this.trailFb); }
    this.trail = this.texture(this.canvas.width, this.canvas.height, gl.RGBA16F, gl.HALF_FLOAT, null, gl.LINEAR);
    this.trailFb = this.framebuffer(this.trail);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.camera();
  }

  camera() {
    const t = this.time, aspect = this.w / this.h;
    // A slow orbit around the middle of the water, plus whatever the viewer drags.
    const yaw = this.view.yaw + Math.sin(t * 0.021) * 0.45;
    const el = Math.max(0.08, Math.min(1.2, this.view.el + Math.sin(t * 0.033) * 0.04));
    const D = this.view.dist, centre = [0, 0, 0.25];
    const eye = [centre[0] + Math.sin(yaw) * Math.cos(el) * D, Math.sin(el) * D, centre[2] - Math.cos(yaw) * Math.cos(el) * D];
    const target = [centre[0], -0.15, centre[2]];
    const fov = (aspect < 1 ? 72 : 50) * Math.PI / 180;
    const z = norm(sub(eye, target)), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    const view = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
    const f = 1 / Math.tan(fov / 2), near = 0.05, far = 20, nf = 1 / (near - far);
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    const vp = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += proj[k * 4 + r] * view[c * 4 + k];
      vp[c * 4 + r] = s;
    }
    Object.assign(this, { vp, eye, right: x, up: y, forward: [-z[0], -z[1], -z[2]], tanHalf: Math.tan(fov / 2), aspect });
  }

  // World (x, y on the water) to screen pixels.
  project(x, y, lift = 0) {
    const v = [x, (this.surface?.height ?? swell)(x, y, this.time) + lift, y, 1], m = this.vp, c = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) c[r] += m[k * 4 + r] * v[k];
    if (c[3] <= 0) return null;
    const nx = c[0] / c[3], ny = c[1] / c[3];
    return { sx: (nx + 1) / 2 * this.w, sy: (1 - ny) / 2 * this.h, nx, ny, depth: c[3] };
  }

  // Screen pixels to the point on the water under them.
  unproject(sx, sy) {
    const nx = sx / this.w * 2 - 1, ny = 1 - sy / this.h * 2;
    const d = [0, 1, 2].map(i => this.forward[i] + this.right[i] * nx * this.tanHalf * this.aspect + this.up[i] * ny * this.tanHalf);
    if (d[1] >= 0) return null;
    const t = -this.eye[1] / d[1];
    const x = this.eye[0] + d[0] * t, y = this.eye[2] + d[2] * t;
    return Math.abs(x) <= BOUNDS.x && Math.abs(y) <= BOUNDS.y ? { x, y } : null;
  }

  // list: { x, y, energy, spin, rgb, loved, drift: [x, y], chop, surge }
  setListeners(list) {
    const d = this.listenerData;
    this.count = Math.min(MAXL, list.length);
    d.fill(0);
    for (let i = 0; i < this.count; i++) {
      const l = list[i];
      d.set([l.x, l.y, l.energy, l.spin], i * 4);
      d.set([...l.rgb, l.loved], (MAXL + i) * 4);
      d.set([l.drift[0], l.drift[1], l.chop, l.surge], (2 * MAXL + i) * 4);
    }
    // Everyone at once: the energy-weighted pull of all their styles, how choppy, how busy.
    let e = 0, wx = 0, wy = 0, chop = 0;
    for (let i = 0; i < this.count; i++) {
      const l = list[i], w = l.energy + l.surge;
      e += w;
      wx += l.drift[0] * w;
      wy += l.drift[1] * w;
      chop += l.chop * w;
    }
    this.mood = e ? { wind: [wx / e, wy / e], chop: chop / e, activity: e / this.count } : { wind: [0, 0], chop: 0.5, activity: 0 };
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.listeners);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAXL, 3, gl.RGBA, gl.FLOAT, d);
  }

  ripple(x, y, rgb, strength = 1) {
    const i = this.nextRipple++ % MAXR;
    this.R.set([x, y, this.time, strength], i * 4);
    this.RC.set(rgb, i * 3);
  }

  bind(prog, name, unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u[name], unit);
  }

  common(prog) {
    this.gl.uniform1f(prog.u.uTime, this.time);
    this.gl.uniform2f(prog.u.uBounds, BOUNDS.x, BOUNDS.y);
  }

  // Listeners and ripples become one texture of flow, height, pigment and mood.
  field() {
    const gl = this.gl, f = this.progs.field;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.useProgram(f.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFb);
    gl.viewport(0, 0, FIELD, FIELD);
    this.common(f);
    this.bind(f, "uListeners", 0, this.listeners);
    gl.uniform1i(f.u.uCount, this.count);
    gl.uniform4fv(f.u.uR, this.R);
    gl.uniform3fv(f.u.uRC, this.RC);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  bindParticles(prog) {
    this.bind(prog, "uPos", 0, this.pos[this.cur]);
    this.bind(prog, "uCol", 1, this.col[this.cur]);
    this.bind(prog, "uFlow", 2, this.fields[0]);
    if (prog.u.uPaint) this.bind(prog, "uPaint", 3, this.fields[1]);
    this.bind(prog, "uMood", 4, this.fields[2]);
  }

  simulate(dt) {
    const gl = this.gl, s = this.progs.sim;
    gl.useProgram(s.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.simFb[1 - this.cur]);
    gl.viewport(0, 0, this.W, this.W);
    this.common(s);
    this.bindParticles(s);
    gl.uniform1f(s.u.uDt, dt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
  }

  render(dt) {
    const gl = this.gl, { fade, particles, composite } = this.progs;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFb);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.enable(gl.BLEND);
    gl.blendColor(0, 0, 0, Math.pow(0.935, dt * 60));
    gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    gl.useProgram(fade.p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(particles.p);
    this.common(particles);
    this.bindParticles(particles);
    gl.uniform1i(particles.u.uTexW, this.W);
    gl.uniformMatrix4fv(particles.u.uViewProj, false, this.vp);
    gl.uniform3fv(particles.u.uEye, this.eye);
    gl.uniform1f(particles.u.uPointScale, 2.6 * this.dpr * Math.sqrt(this.h / 850));
    gl.uniform1f(particles.u.uIntensity, 0.11 * Math.sqrt(262144 / this.N) / this.dpr);
    gl.drawArrays(gl.POINTS, 0, this.N);

    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(composite.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trail);
    gl.uniform1i(composite.u.uTrail, 0);
    gl.uniform1f(composite.u.uTime, this.time);
    gl.uniform1f(composite.u.uExposure, 1.25);
    const horizon = this.project(0, BOUNDS.y);
    gl.uniform1f(composite.u.uHorizon, horizon ? 1 - horizon.sy / this.h : 0.7);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  frame(dt) {
    this.time += dt;
    this.camera();
    this.field();
    // Another surface (the fur) can grow from the same field instead of the particles.
    if (this.surface) return this.surface.frame(dt);
    this.simulate(dt);
    this.render(dt);
  }
}
