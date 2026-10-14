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

import { COMMON, NOISE, FULL_VS, MAXR, program } from "./ocean.js";
import { paletteUniform } from "./palette.js";
import { ground, TIDE_GLSL } from "./tide.js";

const SEG = 7;                  // joints per strand
const R_IN = 2.4, R_OUT = 18;   // even pelt over the listeners, thinning out to the horizon
const INNER = 1 / (1 + 2 * Math.log(R_OUT / R_IN)); // share of strands in the even part
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

// Strand i's root and the spacing between it and its neighbours. Density is even inside
// R_IN and falls off as 1/r^2 beyond, roughly as fast as perspective shrinks it, so the
// pelt looks equally thick all the way out. Strands are scattered at random within each
// thin ring, so there is no lattice or spiral to spot.
vec2 rootOf(int i, out float sp) {
  uint u = uint(i);
  float f = (float(i) + rnd(u * 5u + 11u)) / NSTRANDS;
  float r = f < INNER ? R_IN * sqrt(f / INNER) : R_IN * pow(R_OUT / R_IN, (f - INNER) / (1.0 - INNER));
  sp = SP0 * max(1.0, r / R_IN);
  float a = rnd(u * 5u + 12u) * 6.2831853;
  return r * vec2(cos(a), sin(a));
}

float inside(vec2 p) {
  return smoothstep(0.0, 0.7, uBounds.x - abs(p.x)) * smoothstep(0.0, 0.7, uBounds.y - abs(p.y));
}

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}

// The pelt's colour: the rainbow straight from the hue, or a point on the red ramp.
uniform vec3 uPal[8];
uniform int uPalN;
vec3 swatch(float h, float s, float v) {
  if (uPalN == 0) return hsv(h, s, v);
  float u = (1.0 - abs(2.0 * fract(h) - 1.0)) * float(uPalN - 1); // back and forth along the ramp
  int i = min(int(u), uPalN - 2);
  return mix(uPal[i], uPal[i + 1], smoothstep(0.0, 1.0, u - float(i))) * v * 1.1;
}
`;

// The pelt's own colouring: broad, softly marbled regions drifting across the whole spectrum.
const HUE = `
float furHue(vec2 p, float t, out float marks) {
  vec2 q = p * 0.28;
  vec2 w = vec2(snoise(vec3(q, t * 0.012)), snoise(vec3(q + 5.2, t * 0.012 + 1.3)));
  float n = snoise(vec3(q * 1.2 + w * 0.7, t * 0.02 + 3.0));
  marks = snoise(vec3(q * 2.0 + w * 1.2, t * 0.025 + 9.0));
  return n * 0.5 + marks * 0.06 + t * 0.004 + 0.75;
}
`;

const STRAND_FS = N => `#version 300 es
${COMMON}
${NOISE}
${furCommon(N)}
${HUE}
${TIDE_GLSL}
uniform sampler2D uState;  // lean xy, lean velocity xy
uniform sampler2D uDye;    // dye rgb, amount
uniform sampler2D uLook;   // last frame's colour and length
uniform sampler2D uFlow;
uniform sampler2D uPaint;
uniform sampler2D uMood;
uniform float uDt;
uniform vec2 uDir;        // everyone's styles together: which way the whole pelt is combed
uniform float uComb;      // ... how firmly
uniform vec2 uGust;       // ... and how far the gusts have travelled with it
uniform float uChop;      // ... how bristly it is
uniform float uActivity;  // ... and how hard the wind blows
uniform vec4 uR[${MAXR}];         // song starts: xy, birth time, strength
uniform vec3 uRC[${MAXR}];
layout(location = 0) out vec4 oState;
layout(location = 1) out vec4 oDye;
layout(location = 2) out vec4 oLook;  // colour, length
layout(location = 3) out vec4 oMore;  // frizz, glow, width
layout(location = 4) out vec4 oShape; // ground slope xz, ground height

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
  float chop = mix(uChop, mood.x, in_);
  float glow = min(mood.y, 1.0) * in_;
  float lift = flow.w * in_;   // listening energy: the fur stands up

  // Song starts roll out as waves across the whole pelt, all the way to the horizon,
  // pushing the hair over, lifting it, and leaving a faint wash of the artist's colour.
  vec2 push = vec2(0.0);
  vec3 washC = vec3(0.0);
  float wash = 0.0;
  for (int j = 0; j < ${MAXR}; j++) {
    vec4 R = uR[j];
    float age = uTime - R.z;
    if (R.w <= 0.0 || age < 0.0 || age > 30.0) continue;
    vec2 d = p - R.xy;
    float dist = length(d) + 1e-3;
    float front = dist - age * 0.7;
    float b = exp(-front * front * 6.0) * R.w * smoothstep(0.0, 2.0, age) * (1.0 - age / 30.0) * (0.35 + 0.65 / (1.0 + dist * 0.5));
    push += d / dist * b;
    lift += b * 0.15;
    float tint = b * exp(-age * 0.9); // the colour fades within seconds; the wave rolls on
    washC += uRC[j] * tint;
    wash += tint;
  }

  // Wind over the pelt: gusts rolling across it in long waves, combed the way everyone's
  // styles pull together and blowing harder the more people are listening, a curl-noise
  // breeze, the song-start waves, and the listeners' own currents combing whorls into it.
  // The gust pattern drifts downwind by a distance integrated frame by frame, so when the
  // weather changes the waves speed up or turn gradually instead of jumping. It also keeps
  // reshaping as it goes and is warped by a slower field: plain noise slid in a straight
  // line shows its lattice as a beat every couple of seconds, which the springs pick up.
  vec2 g = p - uGust;
  vec2 warp = vec2(snoise(vec3(p * 0.12, uTime * 0.03)), snoise(vec3(p * 0.12 + 7.3, uTime * 0.03)));
  float gust = 0.75 * snoise(vec3(g * 0.22 + warp * 0.8, uTime * 0.09))
             + 0.25 * snoise(vec3(g * 0.5 + warp * 1.5 + 4.0, uTime * 0.14));
  // The undertow: the tide's ground heaves and folds under the fur, and the hair is
  // dragged downhill with it.
  float g0 = ground(p, uTime);
  vec2 slope = vec2(ground(p + vec2(0.04, 0.0), uTime) - g0, ground(p + vec2(0.0, 0.04), uTime) - g0) / 0.04;
  vec2 wind = uDir * (0.15 + 0.5 * uComb + (0.3 + 0.4 * uActivity) * gust)
            - slope * 1.2
            + curl(vec3(p * 0.35, uTime * 0.03)) * 0.06
            + push * 1.2
            + flow.xy * in_ * 5.0
            + (vec2(r0, r1) - 0.5) * 0.2;
  wind *= 1.0 - 0.65 * min(lift, 1.0);
  float m = length(wind);
  if (m > 1.4) wind *= 1.4 / m;

  // A spring with a little give, so waves overshoot a touch and settle like real fur,
  // damped enough that it never rings on its own.
  float k = mix(9.0, 24.0, chop) * (1.0 + lift);
  vec2 vel = S.zw + ((wind - S.xy) * k - S.zw * 1.4 * sqrt(k)) * uDt;
  vec2 lean = S.xy + vel * uDt;

  // Dye: currents colour the hair they pass, and it slowly grows back out.
  float take = clamp(paint.a * in_ * 1.4, 0.0, 1.0);
  vec3 dye = D.a < 0.02 ? paint.rgb : mix(D.rgb, paint.rgb, clamp(take * uDt * 3.0, 0.0, 1.0));
  float amount = max(D.a * exp(-uDt / 35.0), take);
  if (wash > 0.01) {
    dye = mix(dye, washC / wash, clamp(wash * uDt * 4.0, 0.0, 1.0));
    amount = max(amount, min(wash, 1.0) * 0.45);
  }

  float marks;
  float hue = furHue(p, uTime, marks) + (r2 - 0.5) * 0.03;
  vec3 col = swatch(hue, 0.85 + 0.15 * r0, (0.84 + 0.16 * r1) * mix(0.7, 1.0, smoothstep(-0.5, 0.5, marks)));
  // Overlapping currents average toward grey, so push the dye back to full colour.
  float lum = dot(dye, vec3(0.3, 0.55, 0.15));
  vec3 vivid = clamp(lum + (dye - lum) * 2.4, 0.0, 1.0) * 1.1;
  col = mix(col, vivid, amount * 0.8);

  float len = mix(0.07, 0.11, r1) * mix(1.3, 0.72, chop) * (1.0 + 0.9 * min(lift, 1.0) + 0.4 * glow);
  len = max(len, sp * 3.0);
  // Tufts rise and settle over a second or so rather than snapping when a song starts.
  float was = texelFetch(uLook, ij, 0).w;
  if (was > 0.0) len = mix(was, len, 1.0 - exp(-uDt * 1.2));
  // With fewer strands (phones) they stay as fine as on a big screen, just a little sparser.
  oState = vec4(lean, vel);
  oDye = vec4(dye, amount);
  oLook = vec4(col, len);
  // The ground: the tide, plus the listeners' mounds and ripples from the field.
  oMore = vec4(chop * chop * 1.5 + 0.12, glow, sp * min(1.0, 0.0125 / SP0) * mix(0.45, 0.8, r0), 0.0);
  oShape = vec4(slope, g0 + (flow.z - swell(p, uTime)) * in_, 0.0);
}`;

const HAIR_VS = N => `#version 300 es
${COMMON}
${furCommon(N)}
uniform sampler2D uState;
uniform sampler2D uLook;
uniform sampler2D uMore;
uniform sampler2D uShape;
uniform mat4 uViewProj;
uniform vec2 uRes;
uniform float uPxScale;
uniform float uTip;   // how far the hue shifts toward the tips
out vec3 vCol;
out vec3 vTan;
out vec3 vPos;
out float vT;
out float vAlpha;
out float vGlow;
out float vShade;
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
  vec4 more = texelFetch(uMore, ij, 0);
  float phase = rnd(uint(i) * 3u + 3u) * 6.2831;
  vec4 shape = texelFetch(uShape, ij, 0);
  vec3 pos = vec3(p.x, shape.z, p.y);

  vec4 root = uViewProj * vec4(pos, 1.0);
  float m = 1.3 * root.w + 0.3;
  if (root.w < 0.03 || abs(root.x) > m || abs(root.y) > m) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off screen: skip the whole strand
    return;
  }

  vec4 S = texelFetch(uState, ij, 0);
  vec4 look = texelFetch(uLook, ij, 0);
  int k = gl_VertexID >> 1;
  float side = float(gl_VertexID & 1) * 2.0 - 1.0;

  // Walk up the strand from the root, each joint leaning a little further over.
  float lean = length(S.xy);
  vec2 bd = lean > 1e-4 ? S.xy / lean : vec2(1.0, 0.0);
  float th0 = atan(lean * 1.6 + 0.25);
  float seg = look.w / float(SEG);
  // Hair grows out of the slope, not straight up, so the folds of the ground show.
  vec3 n = normalize(vec3(-shape.x, 1.0, -shape.y));
  vec3 bx = normalize(vec3(n.y, -n.x, 0.0)), bz = cross(bx, n);
  vec3 T = n;
  for (int j = 0; j < SEG; j++) {
    float tj = (float(j) + 0.5) / float(SEG);
    float th = th0 * pow(tj, 0.8) + 0.3 * more.x * sin(tj * 11.0 + phase);
    float az = more.x * 0.8 * sin(tj * 7.0 + phase * 1.7);
    vec2 hd = mat2(cos(az), sin(az), -sin(az), cos(az)) * bd;
    vec3 d = bx * (hd.x * sin(th)) + n * cos(th) + bz * (hd.y * sin(th));
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
  vShade = max(dot(n, normalize(vec3(-0.45, 0.8, -0.35))), 0.0); // slopes facing the light glow
  vCol = mix(look.rgb, hueShift(look.rgb, uTip) * 1.2 + 0.04, t * t);
}`;

const HAIR_FS = `#version 300 es
precision highp float;
uniform vec3 uEye;
uniform vec3 uLight;
uniform vec3 uHaze;
uniform float uPunch;  // 1: brighten keeping the colour's hue and saturation (for the red)
in vec3 vCol;
in vec3 vTan;
in vec3 vPos;
in float vT;
in float vAlpha;
in float vGlow;
in float vShade;
out vec4 o;
void main() {
  vec3 T = normalize(vTan), V = normalize(uEye - vPos), H = normalize(uLight + V);
  float TL = dot(T, uLight), TH = dot(T, H);
  float diff = sqrt(max(0.0, 1.0 - TL * TL));
  float sh = sqrt(max(0.0, 1.0 - TH * TH));
  float ao = mix(0.05, 1.0, pow(vT, 0.85));                 // dark at the roots, deep in the pelt
  float back = pow(max(0.0, dot(-V, uLight)), 3.0) * vT * vT; // light through the tips
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (TH * 0.6 + dot(V, T) * 0.3 + vec3(0.0, 0.33, 0.67)));
  vec3 c = vCol * (0.2 + 0.9 * diff) * ao * mix(0.45, 1.35, vShade)
         + vCol * back * 1.4
         + film * pow(sh, 12.0) * 0.2 * ao
         + vec3(pow(sh, 90.0) * 0.45 * vT);
  c *= 1.0 + vGlow * vT * 2.2; // a loved song lights the tips
  c *= 1.0 + 1.4 * uPunch;  // more light, so the red blazes
  vec3 soft = 1.0 - exp(-c * 1.5);
  float peak = max(max(c.r, c.g), max(c.b, 1e-4));
  vec3 punchy = c * (1.0 - exp(-peak * 1.5)) / peak;
  c = mix(soft, punchy, uPunch);
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
    c = mix(swatch(furHue(p, uTime, marks), 0.7, 0.07), uHaze, 1.0 - exp(-max(0.0, t - 2.5) * 0.11));
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
    this.W = Math.round(Math.sqrt(Math.max(4096, Math.min(1.5e6, count || (small ? 250000 : 420000)))));
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
    this.look = [tex(), tex()];
    this.more = tex();
    this.shape = tex();
    if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 5) throw new Error("The fur needs five render targets");
    this.fb = [0, 1].map(i => ocean.framebuffer(this.state[i], this.dye[i], this.look[i], this.more, this.shape));
    this.cur = 0;
    this.weather = { wind: [0, 0], chop: 0.5, activity: 0.5, gust: [0, 0] };
    this.height = ground; // the ocean places labels on the tide instead of its swell
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

  setPalette(prog, pal) {
    this.gl.uniform3fv(prog.u.uPal, pal.data);
    this.gl.uniform1i(prog.u.uPalN, pal.count);
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
    o.bind(s, "uLook", 5, this.look[this.cur]);
    o.bind(s, "uFlow", 2, o.fields[0]);
    o.bind(s, "uPaint", 3, o.fields[1]);
    o.bind(s, "uMood", 4, o.fields[2]);
    // The collective weather eases toward everyone's current mood over half a minute or so.
    const w = this.weather, m = o.mood, k = 1 - Math.exp(-dt / 8);
    w.wind = w.wind.map((v, i) => v + (m.wind[i] - v) * k);
    w.chop += (m.chop - w.chop) * k;
    w.activity += (m.activity - w.activity) * k;
    const base = [0.871 * 0.3 + w.wind[0], 0.49 * 0.3 + w.wind[1]], len = Math.hypot(...base) || 1;
    const dir = [base[0] / len, base[1] / len];
    const speed = 0.35 + 0.3 * Math.min(1.5, w.activity);
    w.gust = [w.gust[0] + dir[0] * speed * dt, w.gust[1] + dir[1] * speed * dt];
    gl.uniform2fv(s.u.uDir, dir);
    gl.uniform1f(s.u.uComb, Math.hypot(...w.wind));
    gl.uniform2fv(s.u.uGust, w.gust);
    gl.uniform1f(s.u.uChop, w.chop);
    gl.uniform1f(s.u.uActivity, Math.min(1.5, w.activity));
    const pal = paletteUniform();
    this.setPalette(s, pal);
    gl.uniform4fv(s.u.uR, o.R);
    gl.uniform3fv(s.u.uRC, o.RC);
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
    gl.uniform3fv(back.u.uHaze, paletteUniform().haze);
    this.setPalette(back, paletteUniform());
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.useProgram(hair.p);
    o.common(hair);
    gl.uniform1i(hair.u.uW, this.W);
    o.bind(hair, "uState", 0, this.state[this.cur]);
    o.bind(hair, "uLook", 1, this.look[this.cur]);
    o.bind(hair, "uMore", 2, this.more);
    o.bind(hair, "uShape", 3, this.shape);
    gl.uniformMatrix4fv(hair.u.uViewProj, false, o.vp);
    gl.uniform2f(hair.u.uRes, this.w, this.h);
    gl.uniform1f(hair.u.uPxScale, 0.5 * this.h / o.tanHalf);
    gl.uniform3fv(hair.u.uEye, o.eye);
    gl.uniform3fv(hair.u.uLight, LIGHT);
    gl.uniform3fv(hair.u.uHaze, paletteUniform().haze);
    const pal = paletteUniform();
    gl.uniform1f(hair.u.uTip, pal.tip);
    gl.uniform1f(hair.u.uPunch, pal.punch);
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
