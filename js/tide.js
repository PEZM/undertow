// The undertow: the ground under the fur, a slow tide of heaving, folding relief that drifts
// across the whole pelt so everything on its surface rides it.
//
// It runs on the GPU (TIDE_GLSL) and, identically, here in JavaScript, so labels sit on the
// moving surface. Its noise is gradient noise picked by integer hashing: whole-number maths
// is exact on both sides, so the two agree (the GPU's float rounding varies by device, and
// noise that hinges on it would not).

const GRADS = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];

function pcg(v) {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
const corner = (x, y, z) => GRADS[pcg((Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) >>> 0) % 12];
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export function tnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const d = (ox, oy, oz) => {
    const g = corner(ix + ox, iy + oy, iz + oz);
    return g[0] * (fx - ox) + g[1] * (fy - oy) + g[2] * (fz - oz);
  };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  return lerp(
    lerp(lerp(d(0, 0, 0), d(1, 0, 0), u), lerp(d(0, 1, 0), d(1, 1, 0), u), v),
    lerp(lerp(d(0, 0, 1), d(1, 0, 1), u), lerp(d(0, 1, 1), d(1, 1, 1), u), v),
    w,
  );
}

// Big heaves, a middle swell, and ridged creases on top (the folds), all warped together
// and drifting with the tide.
export function ground(x, y, t) {
  const qx = x * 0.32 + t * 0.08, qy = y * 0.32 + t * 0.03;
  const wx = tnoise(qx * 0.7, qy * 0.7, t * 0.04), wy = tnoise(qx * 0.7 + 9.1, qy * 0.7 + 9.1, t * 0.04);
  const a = tnoise(qx + wx * 0.9, qy + wy * 0.9, t * 0.06);
  const b = tnoise(qx * 2.1 + wx * 1.6 + 3.7, qy * 2.1 + wy * 1.6 + 3.7, t * 0.09);
  const r = 1 - Math.abs(tnoise(qx * 3.3 + wx * 2 + 7.3, qy * 3.3 + wy * 2 + 7.3, t * 0.12));
  return 0.6 * a + 0.27 * b + 0.15 * r * r;
}

export const TIDE_GLSL = `
const vec3 TIDE_GRADS[12] = vec3[12](${GRADS.map(g => `vec3(${g.map(v => v.toFixed(1)).join(", ")})`).join(", ")});
uint tidePcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float tideCorner(ivec3 c, vec3 f) {
  uint h = tidePcg(uint(c.x) * 0x8da6b343u ^ uint(c.y) * 0xd8163841u ^ uint(c.z) * 0xcb1ab31fu);
  return dot(TIDE_GRADS[h % 12u], f);
}
float tnoise(vec3 p) {
  vec3 i = floor(p), f = p - i;
  ivec3 c = ivec3(i);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(tideCorner(c, f), tideCorner(c + ivec3(1, 0, 0), f - vec3(1, 0, 0)), u.x),
        mix(tideCorner(c + ivec3(0, 1, 0), f - vec3(0, 1, 0)), tideCorner(c + ivec3(1, 1, 0), f - vec3(1, 1, 0)), u.x), u.y),
    mix(mix(tideCorner(c + ivec3(0, 0, 1), f - vec3(0, 0, 1)), tideCorner(c + ivec3(1, 0, 1), f - vec3(1, 0, 1)), u.x),
        mix(tideCorner(c + ivec3(0, 1, 1), f - vec3(0, 1, 1)), tideCorner(c + ivec3(1, 1, 1), f - vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float ground(vec2 p, float t) {
  vec2 q = p * 0.32 + vec2(t * 0.08, t * 0.03);
  vec2 w = vec2(tnoise(vec3(q * 0.7, t * 0.04)), tnoise(vec3(q * 0.7 + 9.1, t * 0.04)));
  float a = tnoise(vec3(q + w * 0.9, t * 0.06));
  float b = tnoise(vec3(q * 2.1 + w * 1.6 + 3.7, t * 0.09));
  float r = 1.0 - abs(tnoise(vec3(q * 3.3 + w * 2.0 + 7.3, t * 0.12)));
  return 0.6 * a + 0.27 * b + 0.15 * r * r;
}
`;
