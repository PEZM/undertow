// The colours everything is painted in: one extremely bright red, from oxblood shadows through
// crimson and scarlet to pale rose highlights (the default), or the original full-spectrum
// rainbow (?palette=rainbow).
//
// Both are addressed by hue (0-360), so an artist or article keeps one colour for everyone:
// the rainbow uses the hue directly; the red maps it to a point on its ramp.

export const PALETTES = {
  red: {
    name: "Red",
    tip: 0.08,          // tips warm only slightly toward orange or rose, so it stays red
    punch: 1,           // brighten keeping the colour saturated instead of washing toward white
    haze: [0.12, 0.008, 0.02],
    quiet: [0.4, 0.02, 0.05],   // a current with nothing playing
    ramp: [             // dark to light, as rgb 0-1
      [0.3, 0.0, 0.03],     // oxblood
      [0.85, 0.02, 0.08],   // crimson
      [1.0, 0.06, 0.04],    // scarlet
      [1.0, 0.26, 0.16],    // hot red
      [1.0, 0.76, 0.72],    // pale rose
    ],
  },
  rainbow: { name: "Rainbow", tip: 0.55, punch: 0, haze: [0.1, 0.045, 0.14], quiet: [0.2, 0.3, 0.5], ramp: null },
};

export let palette = PALETTES.red;
export function setPalette(name) {
  palette = PALETTES[name] ?? PALETTES.red;
}

export function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export const quietColour = () => [...palette.quiet];

// Somewhere on the ramp (0 = darkest, 1 = lightest).
function rampAt(u) {
  const r = palette.ramp, x = Math.max(0, Math.min(1, u)) * (r.length - 1);
  const i = Math.min(Math.floor(x), r.length - 2), f = x - i;
  return r[i].map((v, c) => v + (r[i + 1][c] - v) * f);
}

// A hue's colour as rgb (0-1). On the red, data colours stay in the bright half of the ramp;
// lightness above 0.56 tints them further toward rose and white.
export function colourOf(hue, light = 0.56, sat = 0.95) {
  if (!palette.ramp) return hsl(hue, sat, light);
  const u = 1 - Math.abs(2 * (((hue % 360) + 360) % 360) / 360 - 1);
  const c = rampAt(0.35 + 0.4 * u);
  const t = Math.max(0, (light - 0.56) / 0.44);
  return c.map(v => v + (1 - v) * t * 0.85);
}

export function cssOf(hue, light = 0.56, sat = 0.95) {
  const [r, g, b] = colourOf(hue, light, sat).map(v => Math.round(Math.min(1, v) * 255));
  return `rgb(${r},${g},${b})`;
}

// For the shaders: the ramp, flattened (empty for the rainbow).
export function paletteUniform() {
  const out = new Float32Array(8 * 3), r = palette.ramp ?? [];
  r.forEach((c, i) => out.set(c, i * 3));
  return { data: out, count: r.length, tip: palette.tip, punch: palette.punch, haze: palette.haze };
}
