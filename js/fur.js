// The same listening, grown as an endless pelt of colourful hair.
//
// Several hundred thousand strands are rooted on a sunflower spiral that runs out to the
// horizon: dense around the listeners, sparser (and coarser) further away. Every frame a
// strand pass reads the ocean's listener field and moves each strand on a spring:
//
// - Currents comb whorls into the fur, like cowlicks, wherever someone is listening.
// - Listening energy makes the fur stand up; a song start rolls a wave through it.
// - Energetic styles make it short, stiff and frizzy; calm ones lay it long and sleek.
// - Every current dyes the hair it passes in its artist's colour, leaving trails that
//   slowly grow back out to the pelt's own shifting rainbow.
// - A loved track makes the tips glow.
//
// Strands are drawn as tapered ribbons with hair lighting (Kajiya-Kay sheen, back-lit
// tips, a thin-film shimmer) into a multisampled buffer, so they stay crisp, not noisy.

import { COMMON, NOISE, FULL_VS, program } from "./ocean.js";

const SEG = 7;                  // joints per strand
const R_IN = 2.4, R_OUT = 18;   // even pelt over the listeners, thinning out to the horizon
const INNER = 1 / (1 + 2 * Math.log(R_OUT / R_IN)); // share of strands in the even part
const HAZE = [0.1, 0.045, 0.14];
const LIGHT = (v => v.map(x => x / Math.hypot(...v)))([0.25, 0.55, 1.0]);
const f = x => x.toFixed(6);

const furCommon = N => `
const float R_IN = ${f(R_IN)};
const float R_OUT = ${f(R_OUT)};
const float INNER = ${f(INNER)};
const float SP0 = ${f(Math.sqrt(Math.PI * R_IN * R_IN / (INNER * N)))};
const float NSTRANDS = ${f(N)};
uniform int uW;

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(uint v) { return float(pcg(v)) / 4294967296.0; }

// Strand i's root on the water and the spacing between it and its neighbours.
// Density is even inside R_IN and falls off as 1/r^2 beyond, roughly as fast as
// perspective shrinks it, so the pelt looks equally thick all the way out.
vec2 rootOf(int i, out float sp) {
  uint u = uint(i);
  float f = (float(i) + 0.5) / NSTRANDS;
  float r = f < INNER ? R_IN * sqrt(f / INNER) : R_IN * pow(R_OUT / R_IN, (f - INNER) / (1.0 - INNER));
  sp = SP0 * max(1.0, r / R_IN);
  float a = float(u * 2654435769u) * (6.2831853 / 4294967296.0); // golden angle, exactly
  vec2 j = vec2(rnd(u * 5u + 11u), rnd(u * 5u + 12u)) - 0.5;
  return r * vec2(cos(a), sin(a)) + j * sp * 0.8;
}

float inside(vec2 p) {
  return smoothstep(0.0, 0.4, uBounds.x - abs(p.x)) * smoothstep(0.0, 0.4, uBounds.y - abs(p.y));
}

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
`;

// The pelt's own colouring: marbled, slowly drifting bands across the whole spectrum.
const HUE = `
float furHue(vec2 p, float t, out float marks) {
  vec2 q = p * 0.45;
  vec2 w = vec2(snoise(vec3(q, t * 0.015)), snoise(vec3(q + 5.2, t * 0.015 + 1.3)));
  float n = snoise(vec3(q * 1.4 + w * 0.9, t * 0.025 + 3.0));
  marks = snoise(vec3(q * 3.2 + w * 1.6, t * 0.03 + 9.0));
  return n * 0.6 + marks * 0.1 + t * 0.004 + 0.75;
}
`;

const STRAND_FS = N => `#version 300 es
${COMMON}
${NOISE}
${furCommon(N)}
${HUE}
uniform sampler2D uState;  // lean xy, lean velocity xy
uniform sampler2D uDye;    // dye rgb, amount
uniform sampler2D uFlow;
uniform sampler2D uPaint;
uniform sampler2D uMood;
uniform float uDt;
layout(location = 0) out vec4 oState;
layout(location = 1) out vec4 oDye;
layout(location = 2) out vec4 oLook;  // colour, length
layout(location = 3) out vec4 oMore;  // frizz, glow, width, phase

vec2 swellSlope(vec2 p, float t) {
  return 0.187 * cos(dot(p, vec2(0.9, 0.45)) * 2.2 - t * 0.5) * vec2(0.9, 0.45)
       + 0.195 * cos(dot(p, vec2(-0.35, 1.0)) * 3.9 - t * 0.7) * vec2(-0.35, 1.0)
       + 0.175 * cos(dot(p, vec2(0.7, -0.75)) * 7.3 - t * 1.1) * vec2(0.7, -0.75)
       + 0.143 * cos(dot(p, vec2(-0.95, -0.2)) * 13.0 - t * 1.6) * vec2(-0.95, -0.2)
       + 0.115 * cos(dot(p, vec2(0.2, 0.98)) * 23.0 - t * 2.3) * vec2(0.2, 0.98);
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int i = ij.y * uW + ij.x;
  uint u = uint(i);
  float sp;
  vec2 p = rootOf(i, sp);
  float r0 = rnd(u * 3u + 1u), r1 = rnd(u * 3u + 2u), r2 = rnd(u * 3u + 3u);
  vec4 S = texelFetch(uState, ij, 0);
  vec4 D = texelFetch(uDye, ij, 0);

  float in_ = inside(p);
  vec2 uv = fuv(p);
  vec4 flow = texture(uFlow, uv);
  vec4 paint = texture(uPaint, uv);
  vec2 mood = texture(uMood, uv).xy;
  float chop = mix(0.4, mood.x, in_);
  float glow = min(mood.y, 1.0) * in_;
  float lift = flow.w * in_;   // listening energy: the fur stands up

  // Wind over the pelt: gusts rolling across it in long waves, a curl-noise breeze,
  // the swell's slope, and the listeners' own currents combing whorls into it.
  vec2 dir = vec2(0.871, 0.49);
  float gust = snoise(vec3(dot(p, dir) * 0.9 - uTime * 0.55, dot(p, vec2(-dir.y, dir.x)) * 0.35, uTime * 0.05));
  vec2 wind = dir * (0.2 + 0.45 * gust)
            + curl(vec3(p * 0.5, uTime * 0.04)) * 0.1
            - swellSlope(p, uTime) * 0.8
            + flow.xy * in_ * 5.0
            + (vec2(r0, r1) - 0.5) * 0.3;
  wind *= 1.0 - 0.65 * min(lift, 1.0);
  float m = length(wind);
  if (m > 1.4) wind *= 1.4 / m;

  // A slightly underdamped spring, so waves overshoot and settle like real fur.
  float k = mix(9.0, 24.0, chop) * (1.0 + lift);
  vec2 vel = S.zw + ((wind - S.xy) * k - S.zw * 0.8 * sqrt(k)) * uDt;
  vec2 lean = S.xy + vel * uDt;

  // Dye: currents colour the hair they pass, and it slowly grows back out.
  float take = clamp(paint.a * in_ * 1.4, 0.0, 1.0);
  vec3 dye = D.a < 0.02 ? paint.rgb : mix(D.rgb, paint.rgb, clamp(take * uDt * 3.0, 0.0, 1.0));
  float amount = max(D.a * exp(-uDt / 35.0), take);

  float marks;
  float hue = furHue(p, uTime, marks) + (r2 - 0.5) * 0.07;
  vec3 col = hsv(hue, 0.75 + 0.25 * r0, (0.62 + 0.38 * r1) * mix(0.5, 1.0, smoothstep(-0.35, 0.25, marks)));
  // Overlapping currents average toward grey, so push the dye back to full colour.
  float lum = dot(dye, vec3(0.3, 0.55, 0.15));
  vec3 vivid = clamp(lum + (dye - lum) * 2.4, 0.0, 1.0) * 1.1;
  col = mix(col, vivid, amount * 0.8);

  float len = mix(0.07, 0.11, r1) * mix(1.3, 0.72, chop) * (1.0 + 1.1 * lift + 0.5 * glow);
  len = max(len, sp * 3.0);
  oState = vec4(lean, vel);
  oDye = vec4(dye, amount);
  oLook = vec4(col, len);
  oMore = vec4(chop * chop * 1.5 + 0.12, glow, sp * mix(0.45, 0.8, r0), r2 * 6.2831);
}`;

const HAIR_VS = N => `#version 300 es
${COMMON}
${furCommon(N)}
uniform sampler2D uState;
uniform sampler2D uLook;
uniform sampler2D uMore;
uniform sampler2D uFlow;
uniform mat4 uViewProj;
uniform vec2 uRes;
uniform float uPxScale;
out vec3 vCol;
out vec3 vTan;
out vec3 vPos;
out float vT;
out float vAlpha;
out float vGlow;
const int SEG = ${SEG};

// Rotates a colour around the grey axis: shifts its hue, keeps its brightness.
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  int i = gl_InstanceID;
  ivec2 ij = ivec2(i % uW, i / uW);
  float sp;
  vec2 p = rootOf(i, sp);
  float h = mix(swell(p, uTime), texture(uFlow, fuv(p)).z, inside(p));
  vec3 pos = vec3(p.x, h, p.y);

  vec4 root = uViewProj * vec4(pos, 1.0);
  float m = 1.3 * root.w + 0.3;
  if (root.w < 0.03 || abs(root.x) > m || abs(root.y) > m) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off screen: skip the whole strand
    return;
  }

  vec4 S = texelFetch(uState, ij, 0);
  vec4 look = texelFetch(uLook, ij, 0);
  vec4 more = texelFetch(uMore, ij, 0);
  int k = gl_VertexID >> 1;
  float side = float(gl_VertexID & 1) * 2.0 - 1.0;

  // Walk up the strand from the root, each joint leaning a little further over.
  float lean = length(S.xy);
  vec2 bd = lean > 1e-4 ? S.xy / lean : vec2(1.0, 0.0);
  float th0 = atan(lean * 1.6 + 0.25);
  float seg = look.w / float(SEG);
  vec3 T = vec3(0.0, 1.0, 0.0);
  for (int j = 0; j < SEG; j++) {
    float tj = (float(j) + 0.5) / float(SEG);
    float th = th0 * pow(tj, 0.8) + 0.3 * more.x * sin(tj * 11.0 + more.w);
    float az = more.x * 0.8 * sin(tj * 7.0 + more.w * 1.7);
    vec2 hd = mat2(cos(az), sin(az), -sin(az), cos(az)) * bd;
    vec3 d = vec3(hd.x * sin(th), cos(th), hd.y * sin(th));
    if (j < k) pos += d * seg;
    if (j == min(k, SEG - 1)) T = d;
  }

  // A ribbon facing the camera, at least a pixel wide; thinner strands fade instead.
  float t = float(k) / float(SEG);
  vec4 c0 = uViewProj * vec4(pos, 1.0);
  vec4 c1 = uViewProj * vec4(pos + T * 0.01, 1.0);
  vec2 sd = (c1.xy / c1.w - c0.xy / c0.w) * uRes;
  sd = dot(sd, sd) > 1e-8 ? normalize(sd) : vec2(0.0, 1.0);
  float wPx = more.z * pow(1.0 - t, 0.7) * uPxScale / c0.w;
  float wDraw = max(wPx, 0.9);
  c0.xy += vec2(-sd.y, sd.x) * side * wDraw / uRes * c0.w;
  gl_Position = c0;

  vAlpha = min(1.0, wPx / wDraw + 0.15);
  vT = t;
  vTan = T;
  vPos = pos;
  vGlow = more.y;
  vCol = mix(look.rgb, hueShift(look.rgb, 0.55) * 1.2 + 0.04, t * t);
}`;

const HAIR_FS = `#version 300 es
precision highp float;
uniform vec3 uEye;
uniform vec3 uLight;
uniform vec3 uHaze;
in vec3 vCol;
in vec3 vTan;
in vec3 vPos;
in float vT;
in float vAlpha;
in float vGlow;
out vec4 o;
void main() {
  vec3 T = normalize(vTan), V = normalize(uEye - vPos), H = normalize(uLight + V);
  float TL = dot(T, uLight), TH = dot(T, H);
  float diff = sqrt(max(0.0, 1.0 - TL * TL));
  float sh = sqrt(max(0.0, 1.0 - TH * TH));
  float ao = mix(0.05, 1.0, pow(vT, 0.85));                 // dark at the roots, deep in the pelt
  float back = pow(max(0.0, dot(-V, uLight)), 3.0) * vT * vT; // light through the tips
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (TH * 0.6 + dot(V, T) * 0.3 + vec3(0.0, 0.33, 0.67)));
  vec3 c = vCol * (0.2 + 0.9 * diff) * ao
         + vCol * back * 1.4
         + film * pow(sh, 12.0) * 0.2 * ao
         + vec3(pow(sh, 90.0) * 0.45 * vT);
  c *= 1.0 + vGlow * vT * 2.2; // a loved song lights the tips
  c = 1.0 - exp(-c * 1.5);
  c = mix(c, uHaze, 1.0 - exp(-max(0.0, length(uEye - vPos) - 2.5) * 0.11));
  o = vec4(c, vAlpha * (1.0 - smoothstep(0.9, 1.0, vT) * 0.6));
}`;

// Behind the hair: the dim skin of the pelt where it shows through, then the sky.
const BACK_FS = N => `#version 300 es
${COMMON}
${NOISE}
${furCommon(N)}
${HUE}
uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uHaze;
in vec2 vUv;
out vec4 o;
void main() {
  vec2 n = vUv * 2.0 - 1.0;
  vec3 d = normalize(uFwd + uRight * n.x * uTanHalf * uAspect + uUp * n.y * uTanHalf);
  vec3 c = mix(uHaze, vec3(0.012, 0.01, 0.03), smoothstep(-0.02, 0.35, d.y));
  if (d.y < 0.0) {
    float t = -uEye.y / d.y, marks;
    vec2 p = uEye.xz + d.xz * t;
    c = mix(hsv(furHue(p, uTime, marks), 0.7, 0.07), uHaze, 1.0 - exp(-max(0.0, t - 2.5) * 0.11));
  }
  o = vec4(c, 1.0);
}`;

const OUT_FS = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform float uTime;
in vec2 vUv;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(uImage, vUv).rgb;
  vec2 q = (vUv - 0.5) * vec2(1.0, 1.25);
  c *= 1.0 - 0.5 * dot(q, q);
  c += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.018;
  o = vec4(c, 1.0);
}`;

export class Fur {
  // count: roughly how many strands to grow.
  constructor(ocean, count) {
    const gl = ocean.gl;
    this.ocean = ocean;
    this.gl = gl;
    const small = Math.min(innerWidth, innerHeight) < 600;
    this.W = Math.round(Math.sqrt(Math.max(4096, Math.min(1.5e6, count || (small ? 150000 : 420000)))));
    this.N = this.W * this.W;
    this.progs = {
      strands: program(gl, FULL_VS, STRAND_FS(this.N)),
      back: program(gl, FULL_VS, BACK_FS(this.N)),
      hair: program(gl, HAIR_VS(this.N), HAIR_FS),
      out: program(gl, FULL_VS, OUT_FS),
    };
    const tex = () => ocean.texture(this.W, this.W, gl.RGBA32F, gl.FLOAT, null, gl.NEAREST);
    this.state = [tex(), tex()];
    this.dye = [tex(), tex()];
    this.look = tex();
    this.more = tex();
    this.fb = [0, 1].map(i => ocean.framebuffer(this.state[i], this.dye[i], this.look, this.more));
    this.cur = 0;
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
  }

  // A multisampled colour + depth buffer the size of the canvas, and a texture to resolve it into.
  targets() {
    const gl = this.gl, { width: w, height: h } = this.ocean.canvas;
    if (this.w === w && this.h === h) return;
    if (this.msFb) {
      gl.deleteRenderbuffer(this.msColor);
      gl.deleteRenderbuffer(this.msDepth);
      gl.deleteFramebuffer(this.msFb);
      gl.deleteTexture(this.image);
      gl.deleteFramebuffer(this.imageFb);
    }
    const rb = format => {
      const r = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, r);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, format, w, h);
      return r;
    };
    this.msColor = rb(gl.RGBA8);
    this.msDepth = rb(gl.DEPTH_COMPONENT24);
    this.msFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
    this.image = this.ocean.texture(w, h, gl.RGBA8, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    this.imageFb = this.ocean.framebuffer(this.image);
    this.w = w;
    this.h = h;
  }

  // Every strand reads the field and springs toward where the wind and the currents push it.
  grow(dt) {
    const gl = this.gl, o = this.ocean, s = this.progs.strands;
    gl.useProgram(s.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[1 - this.cur]);
    gl.viewport(0, 0, this.W, this.W);
    o.common(s);
    gl.uniform1i(s.u.uW, this.W);
    gl.uniform1f(s.u.uDt, Math.max(dt, 1e-4));
    o.bind(s, "uState", 0, this.state[this.cur]);
    o.bind(s, "uDye", 1, this.dye[this.cur]);
    o.bind(s, "uFlow", 2, o.fields[0]);
    o.bind(s, "uPaint", 3, o.fields[1]);
    o.bind(s, "uMood", 4, o.fields[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 1 - this.cur;
  }

  frame(dt) {
    const gl = this.gl, o = this.ocean, { back, hair, out } = this.progs;
    this.targets();
    gl.bindVertexArray(o.vao);
    gl.disable(gl.BLEND);
    this.grow(dt);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(back.p);
    o.common(back);
    gl.uniform3fv(back.u.uEye, o.eye);
    gl.uniform3fv(back.u.uRight, o.right);
    gl.uniform3fv(back.u.uUp, o.up);
    gl.uniform3fv(back.u.uFwd, o.forward);
    gl.uniform1f(back.u.uTanHalf, o.tanHalf);
    gl.uniform1f(back.u.uAspect, o.aspect);
    gl.uniform3fv(back.u.uHaze, HAZE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.useProgram(hair.p);
    o.common(hair);
    gl.uniform1i(hair.u.uW, this.W);
    o.bind(hair, "uState", 0, this.state[this.cur]);
    o.bind(hair, "uLook", 1, this.look);
    o.bind(hair, "uMore", 2, this.more);
    o.bind(hair, "uFlow", 3, o.fields[0]);
    gl.uniformMatrix4fv(hair.u.uViewProj, false, o.vp);
    gl.uniform2f(hair.u.uRes, this.w, this.h);
    gl.uniform1f(hair.u.uPxScale, 0.5 * this.h / o.tanHalf);
    gl.uniform3fv(hair.u.uEye, o.eye);
    gl.uniform3fv(hair.u.uLight, LIGHT);
    gl.uniform3fv(hair.u.uHaze, HAZE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2, this.N);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.imageFb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(out.p);
    o.bind(out, "uImage", 0, this.image);
    gl.uniform1f(out.u.uTime, o.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
