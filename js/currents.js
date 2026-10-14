// Listeners as currents on the water, driven by what they play. (The same machinery runs
// any feed: for Wikipedia, each language is a current and its edits are its "plays".)
//
// - Style: every genre family has a compass direction and a roughness. A listener's
//   recent genres decide which way their water flows and how choppy it is, so people
//   into the same styles form one river.
// - Similarity: listeners are pulled toward people whose recent listening (artists,
//   genres, styles) resembles theirs, so the ocean becomes a shifting map of taste.
// - Song starts: each new track surges the current for a few seconds.
// - Likes: a loved track makes the water glow and the spray rise.
// - In sync: two people on the same artist at the same time meet and orbit.

export const STYLES = [
  { name: "electronic", chop: 0.9, words: ["electronic", "electronica", "house", "techno", "idm", "dance", "dubstep", "trance", "edm", "electro", "drum and bass", "breakbeat", "uk garage", "synthwave"] },
  { name: "ambient", chop: 0.15, words: ["ambient", "downtempo", "chillout", "chill", "trip-hop", "trip hop", "new age", "drone", "lo-fi", "dark ambient"] },
  { name: "jazz", chop: 0.45, words: ["jazz", "spiritual jazz", "cool jazz", "ethio-jazz", "bebop", "piano", "fusion", "free jazz", "jazz fusion", "vocal jazz"] },
  { name: "soul", chop: 0.6, words: ["soul", "neo-soul", "r&b", "rnb", "funk", "disco", "motown", "afrobeat", "gospel", "blues"] },
  { name: "hip-hop", chop: 0.75, words: ["hip-hop", "hip hop", "rap", "trap", "grime", "drill", "boom bap"] },
  { name: "rock", chop: 0.85, words: ["rock", "punk", "post-punk", "alternative", "grunge", "metal", "new wave", "art rock", "krautrock", "classic rock", "shoegaze", "hard rock", "garage rock", "psychedelic rock", "post-rock"] },
  { name: "indie", chop: 0.5, words: ["indie", "indie rock", "dream pop", "art pop", "indie pop", "bedroom pop", "psychedelic", "chamber pop"] },
  { name: "folk", chop: 0.3, words: ["folk", "singer-songwriter", "acoustic", "country", "americana", "indie folk", "freak folk"] },
  { name: "pop", chop: 0.65, words: ["pop", "synthpop", "synth-pop", "k-pop", "soft rock", "dance-pop", "electropop", "j-pop"] },
  { name: "world", chop: 0.55, words: ["mpb", "tropicalia", "flamenco", "latin", "bossa nova", "reggae", "afrobeats", "cumbia", "world", "brazilian", "dub", "salsa"] },
  { name: "classical", chop: 0.2, words: ["classical", "modern classical", "contemporary classical", "opera", "minimalism", "experimental", "neoclassical", "composer", "orchestral"] },
];

// Gives every style a compass direction, and returns a lookup from tags to the first style they match.
export function styleLookup(styles) {
  styles.forEach((s, i) => { s.angle = (i / styles.length) * Math.PI * 2; });
  const of = new Map(styles.flatMap(s => s.words.map(w => [w, s])));
  return tags => {
    for (const t of tags ?? []) {
      const s = of.get(t);
      if (s) return s;
    }
    return null;
  };
}

export function artistKey(name) {
  return (name || "").toLowerCase().replace(/^the\s+/, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

// Same artist, same colour, for everyone.
export function artistHue(name) {
  let h = 2166136261;
  for (const c of artistKey(name)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return (h >>> 0) % 360;
}

export function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function cosine(a, b) {
  if (!a.norm || !b.norm) return 0;
  let d = 0;
  const [small, big] = a.map.size < b.map.size ? [a, b] : [b, a];
  for (const [k, v] of small.map) { const w = big.map.get(k); if (w) d += v * w; }
  return d / (a.norm * b.norm);
}

const QUIET = [0.2, 0.3, 0.5];

// How a feed's activity becomes currents. Music moves over hours; other feeds can be quicker.
const MUSIC = {
  styles: STYLES,
  recent: 6 * 3600,     // listening that shapes someone's currents right now
  halfLife: 3600,       // older plays count for less
  sharedMinutes: 45,    // two people on the same artist this close together meet and orbit
  syncRecent: 720,      // ... as long as both were on it in the last 12 minutes
  syncHalfLife: 900,
  energy: activity => activity * 0.18,
};

export class Currents {
  constructor(options = {}) {
    Object.assign(this, MUSIC, options);
    this.styleOf = styleLookup(this.styles);
    this.state = new Map();
    this.bonds = [];
    this.similarity = new Map();
    this.tagsFor = () => null;
    this.primed = false;
    this.bondKeys = new Set();
  }

  stateFor(p) {
    let s = this.state.get(p);
    if (!s) {
      const r = artistHue(p.name + "#") / 360;
      s = {
        id: this.state.size,
        x: (Math.random() * 2 - 1) * 1.4, y: Math.random() * 1.4 - 1.2, vx: 0, vy: 0,
        f1: 0.7 + r, f2: 1.3 - r * 0.5, ph: r * 100, spin: r > 0.5 ? 1 : -1,
        energy: 0.15, target: 0.15, rgb: [...QUIET], targetRgb: [...QUIET],
        drift: [0, 0], chop: 0.5, style: null, styles: [],
        loved: 0, lovedTarget: 0, surge: 0,
        palette: [], nextColourAt: 0, colourArtist: null, playing: null, last: null,
      };
      this.state.set(p, s);
    }
    return s;
  }

  // A song just started: the current surges, then settles.
  surge(p) {
    this.stateFor(p).surge = 1;
  }

  // Reads everyone's listens. Returns the bonds that just formed, so the page can mark them.
  analyse(people, now) {
    const profiles = new Map(), recentByArtist = new Map();
    for (const p of people) {
      const s = this.stateFor(p);
      const map = new Map(), artists = new Map(), styleW = new Map(), times = new Map();
      let activity = 0, dx = 0, dy = 0, chop = 0, cw = 0;
      s.playing = p.listens.find(l => l.nowPlaying) ?? null;
      s.last = p.listens.reduce((a, l) => (!a || l.ts > a.ts ? l : a), null);
      for (const l of p.listens) {
        const age = now - l.ts;
        if (age > this.recent) continue;
        const w = Math.pow(0.5, age / this.halfLife) + (l.nowPlaying ? 1.5 : 0);
        activity += w;
        const k = artistKey(l.artist);
        // Meeting on the same thing is a human moment: automated plays/edits don't count.
        if (!l.bot) (times.get(k) ?? times.set(k, []).get(k)).push(l.ts);
        const a = artists.get(k) ?? artists.set(k, { artist: l.artist, w: 0 }).get(k);
        a.w += w;
        map.set("a:" + k, (map.get("a:" + k) ?? 0) + w);
        const tags = this.tagsFor(l.artist, l) ?? [];
        for (const t of tags) map.set("t:" + t, (map.get("t:" + t) ?? 0) + w * 0.6);
        const st = this.styleOf(tags);
        if (st) {
          dx += Math.cos(st.angle) * w;
          dy += Math.sin(st.angle) * w;
          chop += st.chop * w;
          cw += w;
          styleW.set(st.name, (styleW.get(st.name) ?? 0) + w);
          map.set("s:" + st.name, (map.get("s:" + st.name) ?? 0) + w * 0.8);
        }
      }
      s.palette = [...artists.values()].sort((a, b) => b.w - a.w).slice(0, 4);
      s.target = 0.12 + Math.min(1.25, this.energy(activity) + (s.playing ? 0.45 : 0));
      s.drift = cw ? [dx / cw, dy / cw] : [0, 0]; // shorter when someone's styles pull different ways
      s.chop = cw ? chop / cw : 0.5;
      s.styles = [...styleW.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
      s.style = s.styles[0] ?? null;
      const current = s.playing ?? (s.last && now - s.last.ts < 600 ? s.last : null);
      s.lovedTarget = current?.loved ? 1 : 0;
      let n2 = 0;
      for (const v of map.values()) n2 += v * v;
      profiles.set(p, { map, norm: Math.sqrt(n2) });
      recentByArtist.set(p, times);
    }

    this.similarity.clear();
    const bonds = [], win = this.sharedMinutes * 60;
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      this.similarity.set(this.pairKey(a, b), cosine(profiles.get(a), profiles.get(b)));
      const ta = recentByArtist.get(a), tb = recentByArtist.get(b);
      const [small, big] = ta.size < tb.size ? [ta, tb] : [tb, ta];
      let best = null;
      for (const [k, xs] of small) {
        const ys = big.get(k);
        if (!ys) continue;
        for (const x of xs) for (const y of ys) {
          if (Math.abs(x - y) > win) continue;
          if (now - Math.min(x, y) > this.syncRecent) continue; // both on it lately
          const strength = Math.pow(0.5, (now - Math.min(x, y)) / this.syncHalfLife);
          if (!best || strength > best.strength) {
            const artist = this.stateFor(a).palette.find(p => artistKey(p.artist) === k)?.artist ?? k;
            best = { a, b, artist, hue: artistHue(artist), strength, key: `${a.name}|${b.name}|${k}` };
          }
        }
      }
      if (best) bonds.push(best);
    }

    // Only pairs that weren't in sync last time are news. Compare against every pair, not
    // just the 15 that get to orbit, or the rest would "meet" again every two seconds.
    const fresh = this.primed ? bonds.filter(b => !this.bondKeys.has(b.key)) : [];
    this.bondKeys = new Set(bonds.map(b => b.key));
    this.bonds = bonds.sort((a, b) => b.strength - a.strength).slice(0, 15);
    this.primed = true;
    return fresh;
  }

  pairKey(a, b) {
    const ia = this.stateFor(a).id, ib = this.stateFor(b).id;
    return ia < ib ? ia * 65536 + ib : ib * 65536 + ia;
  }

  similarityOf(a, b) {
    return this.similarity.get(this.pairKey(a, b)) ?? 0;
  }

  // inView(x, y) gives normalised screen coords so currents stay where you can see them.
  step(people, dt, t, inView) {
    const states = people.map(p => this.stateFor(p));
    const crowd = Math.min(1, 12 / Math.max(1, people.length)); // more people, gentler pull from each
    people.forEach((p, i) => {
      const s = states[i];
      s.energy += (s.target - s.energy) * Math.min(1, dt * 0.5);
      s.loved += (s.lovedTarget - s.loved) * Math.min(1, dt * 0.8);
      s.surge *= Math.exp(-dt / 3.5);

      // Each current cycles through the colours of what it has been playing.
      if (t >= s.nextColourAt) {
        let pick = s.playing ? { artist: s.playing.artist } : null;
        if (!pick || Math.random() < 0.35) {
          const total = s.palette.reduce((sum, a) => sum + a.w, 0);
          let r = Math.random() * total;
          pick = s.palette.find(a => (r -= a.w) <= 0) ?? s.palette[0] ?? null;
        }
        s.colourArtist = pick?.artist ?? null;
        s.targetRgb = pick ? hsl(artistHue(pick.artist), 0.95, 0.56) : [...QUIET];
        s.nextColourAt = t + 4 + Math.random() * 4;
      }
      for (let c = 0; c < 3; c++) s.rgb[c] += (s.targetRgb[c] - s.rgb[c]) * Math.min(1, dt * 0.6);

      // A slow wander of its own, steered by the direction of its style.
      let ax = (Math.sin(t * 0.05 * s.f1 + s.ph) + 0.5 * Math.sin(t * 0.11 * s.f2 + s.ph * 1.3)) * 0.01 + s.drift[0] * 0.006;
      let ay = (Math.cos(t * 0.045 * s.f2 + s.ph * 0.7) + 0.5 * Math.sin(t * 0.09 * s.f1 + s.ph * 2.1)) * 0.008 + s.drift[1] * 0.006;

      // Taste gravity: similar listeners settle near each other, different ones drift apart.
      for (let j = 0; j < people.length; j++) {
        if (i === j) continue;
        const o = states[j], dx = o.x - s.x, dy = o.y - s.y, d = Math.hypot(dx, dy) + 1e-3;
        const sim = this.similarityOf(p, people[j]);
        const rest = 0.3 + (1 - sim) * 1.6;
        const k = (0.006 + 0.035 * sim) * crowd;
        const f = Math.max(-0.03, Math.min(0.03, (d - rest) * k));
        ax += dx / d * f;
        ay += dy / d * f;
        if (d < 0.2) { ax -= dx / d * (0.2 - d) * 0.2; ay -= dy / d * (0.2 - d) * 0.2; }
      }

      // Playing the same artist right now: meet and orbit.
      for (const bd of this.bonds) {
        if (bd.a !== p && bd.b !== p) continue;
        const o = this.stateFor(bd.a === p ? bd.b : bd.a);
        const dx = o.x - s.x, dy = o.y - s.y, d = Math.hypot(dx, dy) + 1e-3;
        const f = Math.max(-0.03, Math.min(0.06, (d - 0.2) * 0.1)) * bd.strength;
        ax += dx / d * f - dy / d * 0.02 * bd.strength;
        ay += dy / d * f + dx / d * 0.02 * bd.strength;
      }

      const v = inView(s.x, s.y);
      if (!v) ay -= 0.08;
      else {
        if (Math.abs(v.nx) > 0.8) ax -= Math.sign(s.x) * (Math.abs(v.nx) - 0.8) * 0.4;
        if (v.ny > 0.1) ay -= (v.ny - 0.1) * 0.5;
        if (v.ny < -0.8) ay += (-0.8 - v.ny) * 0.5;
      }

      s.vx = (s.vx + ax * dt) * Math.exp(-dt * 0.5);
      s.vy = (s.vy + ay * dt) * Math.exp(-dt * 0.5);
    });
    for (const s of states) { s.x += s.vx * dt; s.y += s.vy * dt; }
    return states;
  }
}
