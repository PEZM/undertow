// The colours everything is painted in: a set of punchy artists' pigments led by YInMn Blue
// (the default), or the original full-spectrum rainbow (?palette=rainbow).
//
// Both are addressed by hue (0-360), so an artist or article keeps one colour for everyone:
// the rainbow uses the hue directly, the pigments pick the swatch that hue falls on.

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

export const PALETTES = {
  pigments: {
    name: "Pigments",
    tip: 0.12,   // tips shift hue only slightly, so the pigments stay true
    shift: -0.55, // centre the pelt on the blues; the warm pigments are its accents
    punch: 1,     // keep colours saturated as they brighten instead of washing toward white
    swatches: [
      ["YInMn Blue", "#2E5090"],
      ["International Klein Blue", "#002FA7"],
      ["YInMn Blue", "#2E5090"],
      ["Opera Rose", "#D6247F"],
      ["Vermilion", "#E34234"],
      ["Cadmium Orange", "#F28C28"],
      ["Hansa Yellow", "#F9D71C"],
      ["Cobalt Teal", "#0AA59B"],
    ].map(([name, h]) => ({ name, rgb: hex(h) })),
  },
  rainbow: { name: "Rainbow", tip: 0.55, shift: 0, punch: 0, swatches: null },
};

export let palette = PALETTES.pigments;
export function setPalette(name) {
  palette = PALETTES[name] ?? PALETTES.pigments;
}

export function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

// A hue's colour as rgb (0-1). Lightness above 0.56 tints a pigment toward white.
export function colourOf(hue, light = 0.56, sat = 0.95) {
  const sw = palette.swatches;
  if (!sw) return hsl(hue, sat, light);
  const c = sw[Math.floor((((hue % 360) + 360) % 360) / 360 * sw.length)].rgb;
  const t = Math.max(0, (light - 0.56) / 0.44);
  return c.map(v => v + (1 - v) * t);
}

export function cssOf(hue, light = 0.56, sat = 0.95) {
  const [r, g, b] = colourOf(hue, light, sat).map(v => Math.round(v * 255));
  return `rgb(${r},${g},${b})`;
}

// For the shaders: up to eight swatches, flattened (none for the rainbow).
export function paletteUniform() {
  const out = new Float32Array(8 * 3), sw = palette.swatches ?? [];
  sw.forEach((s, i) => out.set(s.rgb, i * 3));
  return { data: out, count: sw.length, tip: palette.tip, shift: palette.shift, punch: palette.punch };
}
