import { CONFIG } from "../config.js";
import { fetchListens, artistTags } from "./sources.js";
import { Ocean, BOUNDS } from "./ocean.js";
import { Fur } from "./fur.js";
import { Currents, artistHue } from "./currents.js";
import { colourOf, cssOf, detailCss, setPalette, PALETTES } from "./palette.js";
import { makeDemo, demoTick, DEMO_TAGS } from "./demo.js";
import { WikiFeed, WIKI_TIMING, wikiTags } from "./wiki.js";

const glCanvas = document.getElementById("ocean");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const statusEl = document.getElementById("status");
const tip = document.getElementById("tip");

let ocean;
try {
  ocean = new Ocean(glCanvas);
} catch (e) {
  statusEl.textContent = `${e.message}. Try a recent Chrome, Safari or Firefox.`;
  throw e;
}

// Two ways to see the same field: the particle ocean, or an endless pelt of fur.
// The fur is the default; ?view=ocean opens on the ocean; ?hairs=600000 grows more (or fewer) strands.
const viewBtn = document.getElementById("view");
const CAMERAS = { fur: { yaw: 0, el: 0.82, dist: 3.4 }, ocean: { yaw: 0, el: 0.3, dist: 2.4 } };
const FUR_FIELD = { x: 8, y: 8 }; // the fur's listener field reaches far out toward the horizon
let fur = null;
function setView(name) {
  if (name === "fur") {
    try {
      fur ??= new Fur(ocean, Number(new URLSearchParams(location.search).get("hairs")) || 0);
    } catch (e) {
      console.error(e);
      name = "ocean";
    }
  }
  ocean.surface = name === "fur" ? fur : null;
  if (ocean.surface) ocean.setField(FUR_FIELD, Math.min(innerWidth, innerHeight) < 600 ? 384 : 512, 0.12);
  else ocean.setField(BOUNDS);
  // On the fur, ripples keep rolling outward well past the edges of the screen.
  [ocean.rippleLife, ocean.rippleSpeed] = ocean.surface ? [25, 0.36] : [8, 0.24];
  // Each view opens on its own camera: the fur seen from high above, the ocean from near the water.
  Object.assign(ocean.view, CAMERAS[name]);
  viewBtn.textContent = name === "fur" ? "Ocean" : "Fur";
  viewBtn.setAttribute("aria-pressed", String(name === "fur"));
  const q = new URLSearchParams(location.search);
  if (name === "ocean") q.set("view", "ocean");
  else q.delete("view");
  history.replaceState(null, "", q.size ? `?${q}` : location.pathname);
}
setView(new URLSearchParams(location.search).get("view") === "ocean" ? "ocean" : "fur");
viewBtn.addEventListener("click", () => setView(ocean.surface ? "ocean" : "fur"));

const params = new URLSearchParams(location.search);

// What it's painted in: plain white fur (the default), ?palette=red or ?palette=rainbow.
// The button steps through them in turn.
const PALETTE_ORDER = ["white", "red", "rainbow"];
const PALETTE = PALETTE_ORDER.includes(params.get("palette")) ? params.get("palette") : "white";
setPalette(PALETTE);
const paletteBtn = document.getElementById("palette");
const nextPalette = PALETTE_ORDER[(PALETTE_ORDER.indexOf(PALETTE) + 1) % PALETTE_ORDER.length];
paletteBtn.textContent = PALETTES[nextPalette].name;
paletteBtn.addEventListener("click", () => {
  const q = new URLSearchParams(location.search);
  if (nextPalette === "white") q.delete("palette");
  else q.set("palette", nextPalette);
  location.search = q.size ? `?${q}` : "";
});

// What drives the water: live Wikipedia edits (the default), or people's music (?feed=music).
const FEED = params.get("feed") === "music" || params.has("users") || params.has("demo") ? "music" : "wiki";
const feedBtn = document.getElementById("feed");
feedBtn.textContent = FEED === "wiki" ? "Music" : "Wikipedia";
feedBtn.addEventListener("click", () => {
  const q = new URLSearchParams(location.search);
  for (const k of ["feed", "users", "demo", "listeners"]) q.delete(k);
  if (FEED === "wiki") q.set("feed", "music");
  location.search = q.size ? `?${q}` : "";
});

// The words for each feed: a current is a listener or a language, and so on.
const WORDS = FEED === "wiki" ? {
  who: n => `${n} language${n === 1 ? "" : "s"}`,
  active: n => `${n} editing now`,
  bonds: n => `${n} article${n === 1 ? "" : "s"} shared`,
  now: "editing now",
  quiet: "quiet lately",
  lately: "lately",
  sync: (other, title) => `also editing ${title} in ${other}`,
  kin: "most alike",
  bondDetail: () => "2 languages at once",
} : {
  who: n => `${n} listener${n === 1 ? "" : "s"}`,
  active: n => `${n} playing now`,
  bonds: n => `${n} in sync`,
  now: "playing now",
  quiet: "quiet lately",
  lately: "lately",
  sync: (other, artist) => `in sync with ${other} on ${artist}`,
  kin: "closest taste",
  bondDetail: artist => ["sync ×2", styleName(artist)].filter(Boolean).join(" · "),
};

const currents = new Currents(FEED === "wiki" ? WIKI_TIMING : { sharedMinutes: CONFIG.sharedMinutes });

let people = [];   // everyone we were asked to show
let shown = [];    // the ones whose listening loaded
let demo = false;
let wiki = null;   // the Wikipedia feed, when that's what drives the water
let lastWave = 0;
let updatedAt = null;
let tags = [];     // now and then one particle lights up and names its artist
let lastTagAt = -Infinity, tagGap = 5;
let pointer = null;
let exportRequested = false;
const nowSec = () => Date.now() / 1000;

// ?users=lb:alice,lfm:bob tries people out without editing participants.json
async function loadParticipants() {
  const q = new URLSearchParams(location.search);
  if (q.has("demo")) return null;
  if (q.get("users")) {
    const sources = { lb: "listenbrainz", lfm: "lastfm" };
    return q.get("users").split(",").map(s => {
      const [src, user] = s.split(":");
      return { name: user, source: sources[src] ?? src, user };
    });
  }
  try {
    const res = await fetch("participants.json", { cache: "no-store" });
    const list = await res.json();
    const real = list.filter(p => p.user && !p.user.startsWith("YOUR_"));
    return real.length ? real : null;
  } catch {
    return null;
  }
}

// A tag rides one particle in someone's current. Only now and then, so each one is a
// small event; loved songs and two people meeting get to cut in a little sooner.
function tag(state, artist, detail, hue, priority = false) {
  const since = ocean.time - lastTagAt;
  if (since < (priority ? Math.min(tagGap, 4) : tagGap) || tags.length >= 2) return;
  const pr = ocean.project(state.x, state.y);
  if (!pr || pr.sx < 60 || pr.sx > innerWidth - 60 || pr.sy < 110 || pr.sy > innerHeight - 40) return;
  if (tags.some(t => t.artist === artist.toUpperCase())) return;
  lastTagAt = ocean.time;
  tagGap = 9 + Math.random() * 7;
  tags.push({ state, artist: artist.toUpperCase(), detail, hue, born: ocean.time, angle: Math.random() * Math.PI * 2, radius: 0.06 + Math.random() * 0.08 });
}

function styleName(artist, listen) {
  return currents.styleOf(currents.tagsFor(artist, listen))?.name ?? null;
}

// A song starts (or an article changes): the current surges and a ring wave rolls out.
function splash(person, listen) {
  const s = currents.stateFor(person), hue = artistHue(listen.artist);
  currents.surge(person);
  ocean.ripple(s.x, s.y, colourOf(hue, 0.65, 0.9), listen.loved ? 1.5 : 1.1);
  const detail = FEED === "wiki"
    ? [person.name, listen.track].join(" · ")
    : [styleName(listen.artist, listen), listen.loved ? "♥ loved" : "new track"].filter(Boolean).join(" · ");
  const title = listen.artist.length > 44 ? listen.artist.slice(0, 42) + "…" : listen.artist;
  tag(s, title, detail, hue, !!listen.loved);
}

function analyse() {
  if (wiki) shown = people = wiki.people(nowSec());
  for (const bd of currents.analyse(shown, nowSec())) {
    const a = currents.stateFor(bd.a), b = currents.stateFor(bd.b);
    ocean.ripple((a.x + b.x) / 2, (a.y + b.y) / 2, colourOf(bd.hue, 0.7, 0.9), 1.6);
    tag({ get x() { return (a.x + b.x) / 2; }, get y() { return (a.y + b.y) / 2; }, spin: a.spin },
      bd.artist, WORDS.bondDetail(bd.artist), bd.hue, true);
  }
  updateStatus();
}
setInterval(analyse, 2000);

const listenKey = l => `${l.ts}|${l.artist}|${l.track}`;

function announceNew(p, fresh) {
  const known = new Set(p.listens.filter(l => !l.nowPlaying).map(listenKey));
  const np = fresh.find(l => l.nowPlaying);
  const npKey = np ? `${np.artist}|${np.track}` : null;
  if (np && npKey !== p.npKey) splash(p, np);
  else for (const l of fresh.filter(l => !l.nowPlaying && !known.has(listenKey(l))).slice(0, 2)) splash(p, l);
  p.npKey = npKey;
}

async function refresh() {
  const since = Math.floor(nowSec() - CONFIG.historyHours * 3600);
  const results = await Promise.allSettled(people.map(p => fetchListens(p, since)));
  results.forEach((r, i) => {
    const p = people[i];
    if (r.status === "rejected") { p.error = r.reason.message; return; }
    if (p.loaded) announceNew(p, r.value);
    else p.npKey = (n => n && `${n.artist}|${n.track}`)(r.value.find(l => l.nowPlaying));
    p.listens = r.value;
    p.loaded = true;
    p.error = null;
  });
  updatedAt = new Date();
  shown = people.filter(p => p.loaded);
  analyse();
}

function updateStatus() {
  const playing = shown.filter(p => p.listens.some(l => l.nowPlaying)).length;
  const parts = [WORDS.who(shown.length), WORDS.active(playing)];
  if (currents.bonds.length) parts.push(WORDS.bonds(currents.bonds.length));
  if (wiki) {
    parts.push(wiki.error ?? `${wiki.perMinute.toLocaleString("en")} edits a minute · live from Wikipedia`);
    statusEl.textContent = parts.join(" · ");
    return;
  }
  if (demo) parts.push("demo data");
  else if (updatedAt) parts.push(`updated ${updatedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`);
  statusEl.textContent = parts.join(" · ");
  const failed = people.filter(p => p.error);
  if (failed.length && !demo) {
    const warn = document.createElement("span");
    warn.className = "warn";
    warn.textContent = ` · ${failed.length} couldn't load`;
    warn.title = failed.map(p => `${p.name}: ${p.error}`).join("\n");
    statusEl.append(warn);
  }
}

function startDemo() {
  demo = true;
  currents.tagsFor = a => DEMO_TAGS[a] ?? null;
  const count = Number(new URLSearchParams(location.search).get("listeners")) || 100;
  people = shown = makeDemo(Math.max(2, Math.min(128, count)));
  analyse();
  // Roughly one song start every four minutes per active listener.
  (function tick() {
    setTimeout(() => {
      const hit = demoTick(people);
      if (hit) splash(hit.person, hit.listen);
      tick();
    }, (240000 / Math.max(4, people.length * 0.6)) * (0.5 + Math.random()));
  })();
}

// Wikipedia: every article edit flows into its language's current. Only some make a wave:
// new articles and big edits, and never more than one every couple of seconds, or one per
// language every quarter of a minute, so a busy wiki can't drown the rest.
function startWiki() {
  currents.tagsFor = wikiTags;
  wiki = new WikiFeed((p, edit, replayed) => {
    if (replayed || edit.bot || !(edit.isNew || Math.abs(edit.delta) >= 1500)) return;
    const t = performance.now();
    if (t - lastWave < 2000 || t - (p.lastWave ?? -Infinity) < 15000 || !shown.includes(p)) return;
    lastWave = p.lastWave = t;
    splash(p, edit);
  });
  wiki.start();
  statusEl.textContent = "Joining Wikipedia…";
}

async function start() {
  if (FEED === "wiki") return startWiki();
  const list = await loadParticipants();
  if (!list) return startDemo();
  currents.tagsFor = artistTags;
  people = list.map(p => ({ ...p, listens: [] }));
  statusEl.textContent = `Gathering ${people.length} listeners…`;
  await refresh();
  if (!shown.length) return startDemo();
  setInterval(refresh, CONFIG.pollSeconds * 1000);
}

const TAG_LIFE = 7;
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

function drawOverlay() {
  const dpr = ocean.dpr, w = innerWidth, h = innerHeight;
  if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
    overlay.width = Math.round(w * dpr);
    overlay.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  tags = tags.filter(t => ocean.time - t.born < TAG_LIFE);
  for (const t of tags) {
    const age = ocean.time - t.born;
    // The tagged particle circles in its current like any other.
    const a = t.angle + age * 0.5 * (t.state.spin ?? 1);
    const pr = ocean.project(t.state.x + Math.cos(a) * t.radius, t.state.y + Math.sin(a) * t.radius, 0.1 + age * 0.012);
    if (!pr) continue;
    const alpha = Math.min(1, (TAG_LIFE - age) / 1.2);
    const { sx, sy } = pr;

    // The particle: a bright point with a single ping when it lights up.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = cssOf(t.hue, 0.88, 0.9);
    ctx.shadowColor = cssOf(t.hue, 0.65);
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (age < 0.8) {
      ctx.globalAlpha = alpha * (1 - age / 0.8);
      ctx.strokeStyle = cssOf(t.hue, 0.8, 0.9);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(sx, sy, 2 + age * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // A hairline callout, typed out character by character.
    const shown = Math.max(0, Math.floor((age - 0.3) * 30));
    const line1 = t.artist.slice(0, shown), line2 = t.detail.toUpperCase().slice(0, Math.max(0, shown - t.artist.length));
    ctx.font = `500 9.5px ${MONO}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1.2px";
    const width = Math.max(ctx.measureText(t.artist).width, 40);
    const dir = sx + 18 + width > w - 12 ? -1 : 1;
    const ex = sx + dir * 14, ey = sy - 14, tx = dir > 0 ? ex + 3 : ex - 3 - width;
    const grow = Math.min(1, age / 0.35);
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = cssOf(t.hue, 0.85, 0.6);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(sx + dir * 3, sy - 3);
    ctx.lineTo(sx + dir * (3 + 11 * grow), sy - 3 - 11 * grow);
    if (grow === 1) ctx.lineTo(ex + dir * (width + 6) * Math.min(1, (age - 0.35) * 4), ey);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.95;
    ctx.fillStyle = cssOf(t.hue, 0.9, 0.7);
    ctx.fillText(line1, tx, ey - 4);
    ctx.font = `400 7.5px ${MONO}`;
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = detailCss();
    ctx.fillText(line2, tx, ey + 9);
  }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;
}

function ago(ts) {
  const m = Math.round((nowSec() - ts) / 60);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

function nearest(mx, my) {
  let best = null, bd = 70;
  for (const p of shown) {
    const s = currents.stateFor(p), pr = ocean.project(s.x, s.y);
    const d = pr && Math.hypot(pr.sx - mx, pr.sy - my);
    if (d != null && d < bd) { bd = d; best = p; }
  }
  return best;
}

function line(text, className) {
  const el = document.createElement("div");
  el.textContent = text;
  if (className) el.className = className;
  tip.append(el);
}

function showTip(e) {
  const p = nearest(e.clientX, e.clientY);
  pointer = p && { person: p };
  if (!p) { tip.hidden = true; return; }
  const s = currents.stateFor(p);
  tip.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = p.name;
  tip.append(name);
  const l = s.playing ?? s.last;
  line(l ? `${l.artist}${l.track ? " — " + l.track : ""} · ${l.nowPlaying ? WORDS.now : ago(l.ts)}` : WORDS.quiet);
  if (s.palette.length > 1) line(`${WORDS.lately}: ${s.palette.map(a => a.artist).join(", ")}`, "muted");
  if (s.styles.length) line(`currents: ${s.styles.slice(0, 3).join(" / ")}${s.lovedTarget ? " · ♥ loved" : ""}`, "muted");
  for (const bd of currents.bonds.filter(b => b.a === p || b.b === p)) {
    line(WORDS.sync((bd.a === p ? bd.b : bd.a).name, bd.artist), "shared");
  }
  const kin = shown.filter(q => q !== p).map(q => [q, currents.similarityOf(p, q)]).sort((a, b) => b[1] - a[1])[0];
  if (kin && kin[1] > 0.15) line(`${WORDS.kin}: ${kin[0].name} (${Math.round(kin[1] * 100)}%)`, "muted");
  tip.hidden = false;
  const x = Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 8);
  const y = e.clientY + 20 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 14 : e.clientY + 20;
  tip.style.transform = `translate(${x}px, ${y}px)`;
}

// Drag to orbit, scroll or pinch-zoom to move closer, tap the water to ripple it.
let drag = null;
overlay.addEventListener("pointerdown", e => {
  drag = { x: e.clientX, y: e.clientY, yaw: ocean.view.yaw, el: ocean.view.el, moved: false };
  overlay.setPointerCapture(e.pointerId);
});
overlay.addEventListener("pointermove", e => {
  if (!drag) return showTip(e);
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  if (!drag.moved) return;
  tip.hidden = true;
  ocean.view.yaw = drag.yaw - dx * 0.005;
  ocean.view.el = Math.max(0.08, Math.min(1.2, drag.el + dy * 0.004));
});
overlay.addEventListener("pointerup", e => {
  if (drag && !drag.moved) {
    const hit = ocean.unproject(e.clientX, e.clientY);
    if (hit) ocean.ripple(hit.x, hit.y, [0.85, 0.92, 1], 1.1);
  }
  drag = null;
});
overlay.addEventListener("pointerleave", () => { tip.hidden = true; pointer = null; });
overlay.addEventListener("wheel", e => {
  e.preventDefault();
  // The fur rewards a closer look.
  ocean.view.dist = Math.max(ocean.surface ? 0.6 : 1.2, Math.min(4.5, ocean.view.dist * (1 + e.deltaY * 0.001)));
}, { passive: false });

// The interface steps aside when nobody is touching it.
let idleTimer;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), 4000);
}
addEventListener("pointermove", wake);
addEventListener("keydown", wake);
wake();

document.getElementById("fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
document.getElementById("export").addEventListener("click", () => { exportRequested = true; });

function saveFrame() {
  const out = document.createElement("canvas");
  out.width = glCanvas.width;
  out.height = glCanvas.height;
  const g = out.getContext("2d");
  g.drawImage(glCanvas, 0, 0);
  g.drawImage(overlay, 0, 0, out.width, out.height);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  out.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `undertow-${stamp}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

const speed = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.25 : 1;
// Keeps currents where they can be seen. On the ocean they stay in the near half of the
// screen; on the fur they may roam all the way out toward the horizon, whichever way the
// camera faces.
function keepOcean(x, y) {
  const v = ocean.project(x, y);
  if (!v) return [0, -0.08];
  let ax = 0, ay = 0;
  if (Math.abs(v.nx) > 0.8) ax -= Math.sign(x) * (Math.abs(v.nx) - 0.8) * 0.4;
  if (v.ny > 0.1) ay -= (v.ny - 0.1) * 0.5;
  if (v.ny < -0.8) ay += (-0.8 - v.ny) * 0.5;
  return [ax, ay];
}
// How far apart the fur's currents settle: as much as the ground in view allows, so they fill
// the screen whether the camera looks down from above or out to the horizon.
function furSpread() {
  const a = ocean.unproject(innerWidth * 0.1, innerHeight * 0.55), b = ocean.unproject(innerWidth * 0.9, innerHeight * 0.55);
  const across = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 12;
  return Math.max(1, Math.min(2.5, across / 4.5));
}
function keepFur(x, y) {
  const fl = Math.hypot(ocean.forward[0], ocean.forward[2]) || 1, rl = Math.hypot(ocean.right[0], ocean.right[2]) || 1;
  const fx = ocean.forward[0] / fl, fy = ocean.forward[2] / fl, rx = ocean.right[0] / rl, ry = ocean.right[2] / rl;
  const v = ocean.project(x, y);
  if (!v) return [fx * 0.12, fy * 0.12]; // behind the camera: come round in front
  let k = 0, s = 0; // push along the view (toward the horizon) and across it
  if (Math.abs(v.nx) > 0.85) s -= Math.sign(v.nx) * (Math.abs(v.nx) - 0.85) * 0.5;
  if (v.ny > 0.6) k -= (v.ny - 0.6) * 0.6;
  if (v.ny < -0.85) k += (-0.85 - v.ny) * 0.6;
  let ax = fx * k + rx * s, ay = fy * k + ry * s;
  const r = Math.hypot(x, y), edge = FUR_FIELD.x - 1;
  if (r > edge) { ax -= x / r * (r - edge) * 0.1; ay -= y / r * (r - edge) * 0.1; }
  return [ax, ay];
}
for (let i = 0; i < 90; i++) ocean.frame(1 / 30); // let the currents settle before the first look
let last = performance.now();
requestAnimationFrame(function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000) * speed;
  last = now;
  currents.spread = ocean.surface ? furSpread() : 1; // the fur gives currents room to spread out
  const states = currents.step(shown, dt, ocean.time, ocean.surface ? keepFur : keepOcean);
  ocean.setListeners(states.map(s => ({
    x: s.x, y: s.y, energy: s.energy, spin: s.spin, rgb: s.rgb,
    loved: s.loved, drift: s.drift, chop: s.chop, surge: s.surge,
  })));
  ocean.frame(dt);
  drawOverlay();
  if (exportRequested) { exportRequested = false; saveFrame(); }
  requestAnimationFrame(loop);
});

start();
