// Made-up listeners so the ocean has something to show before anyone joins.

export const DEMO_TAGS = {
  "Radiohead": ["alternative", "art rock", "electronic"],
  "Björk": ["electronic", "art pop", "experimental"],
  "Khruangbin": ["psychedelic", "funk", "soul"],
  "Bonobo": ["downtempo", "electronic", "chillout"],
  "Fela Kuti": ["afrobeat", "funk", "jazz"],
  "Nina Simone": ["jazz", "soul", "blues"],
  "Aphex Twin": ["idm", "electronic", "ambient"],
  "Fleetwood Mac": ["classic rock", "pop", "soft rock"],
  "Kendrick Lamar": ["hip-hop", "rap", "jazz"],
  "Mitski": ["indie", "indie rock", "art pop"],
  "Floating Points": ["electronic", "jazz", "house"],
  "Alice Coltrane": ["spiritual jazz", "jazz", "ambient"],
  "Daft Punk": ["house", "electronic", "dance"],
  "Massive Attack": ["trip-hop", "electronic", "downtempo"],
  "Erykah Badu": ["neo-soul", "soul", "hip-hop"],
  "Sufjan Stevens": ["indie folk", "folk", "singer-songwriter"],
  "Boards of Canada": ["ambient", "idm", "electronic"],
  "Rosalía": ["flamenco", "pop", "experimental"],
  "Burial": ["dubstep", "electronic", "ambient"],
  "Talking Heads": ["new wave", "art rock", "funk"],
  "Arthur Russell": ["experimental", "disco", "folk"],
  "Caetano Veloso": ["mpb", "tropicalia", "folk"],
  "Portishead": ["trip-hop", "electronic", "alternative"],
  "Beach House": ["dream pop", "indie", "shoegaze"],
  "Four Tet": ["electronic", "house", "idm"],
  "Mulatu Astatke": ["ethio-jazz", "jazz", "funk"],
  "The Cure": ["post-punk", "new wave", "alternative"],
  "Kraftwerk": ["electronic", "krautrock", "synthpop"],
  "Bill Evans": ["cool jazz", "jazz", "piano"],
  "Frank Ocean": ["r&b", "soul", "pop"],
  "Tame Impala": ["psychedelic", "indie", "pop"],
  "Brian Eno": ["ambient", "experimental", "electronic"],
  "Nils Frahm": ["modern classical", "ambient", "piano"],
  "Max Richter": ["modern classical", "classical", "ambient"],
  "Philip Glass": ["minimalism", "classical", "contemporary classical"],
  "Arvo Pärt": ["contemporary classical", "classical", "minimalism"],
  "Joni Mitchell": ["folk", "singer-songwriter", "jazz"],
  "Nick Drake": ["folk", "singer-songwriter", "acoustic"],
  "Bon Iver": ["indie folk", "folk", "indie"],
  "Phoebe Bridgers": ["indie", "singer-songwriter", "indie folk"],
  "Joy Division": ["post-punk", "rock", "new wave"],
  "Nirvana": ["grunge", "rock", "alternative"],
  "Sonic Youth": ["alternative", "noise rock", "rock"],
  "My Bloody Valentine": ["shoegaze", "rock", "dream pop"],
  "Idles": ["post-punk", "punk", "rock"],
  "Fontaines D.C.": ["post-punk", "rock", "indie"],
  "A Tribe Called Quest": ["hip-hop", "jazz rap", "rap"],
  "MF DOOM": ["hip-hop", "rap", "underground hip-hop"],
  "Little Simz": ["hip-hop", "rap", "grime"],
  "Skepta": ["grime", "hip-hop", "rap"],
  "Tyler, The Creator": ["hip-hop", "rap", "neo-soul"],
  "D'Angelo": ["neo-soul", "soul", "r&b"],
  "Marvin Gaye": ["soul", "motown", "r&b"],
  "Sade": ["soul", "r&b", "jazz"],
  "Solange": ["r&b", "neo-soul", "soul"],
  "Bad Bunny": ["latin", "reggaeton", "pop"],
  "Buena Vista Social Club": ["latin", "cuban", "world"],
  "Tinariwen": ["world", "desert blues", "blues"],
  "Bob Marley": ["reggae", "roots reggae", "world"],
  "Jorge Ben Jor": ["mpb", "brazilian", "samba"],
  "Charli XCX": ["pop", "electropop", "dance-pop"],
  "Robyn": ["pop", "electropop", "dance-pop"],
  "Caribou": ["electronic", "house", "psychedelic"],
  "Jamie xx": ["electronic", "house", "uk garage"],
  "Fred again..": ["house", "electronic", "dance"],
  "Overmono": ["electronic", "breakbeat", "uk garage"],
  "Stereolab": ["indie", "krautrock", "pop"],
  "Cocteau Twins": ["dream pop", "shoegaze", "ambient"],
  "Harold Budd": ["ambient", "new age", "piano"],
  "Hiroshi Yoshimura": ["ambient", "new age", "japanese"],
};
const ARTISTS = Object.keys(DEMO_TAGS);
const LEANINGS = ["electronic", "ambient", "jazz", "soul", "hip-hop", "rock", "indie", "folk", "pop", "world", "classical"];
const FIRST = ["Ada", "Kofi", "Mira", "Tomás", "Yuki", "Lena", "Ravi", "Noor", "Sam", "Iris", "Jun", "Femi", "Zara", "Leo", "Ama", "Ines", "Kai", "Maya", "Omar", "Rosa",
  "Theo", "Uma", "Vik", "Wren", "Xia", "Yara", "Zeno", "Bea", "Cyrus", "Dani", "Eli", "Freya", "Gus", "Hana", "Ivo", "Jada", "Kenji", "Luz", "Milo", "Nia"];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const nowTs = () => Math.floor(Date.now() / 1000);
const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);

const STYLE_WORDS = {
  electronic: ["electronic", "house", "idm", "dance", "dubstep", "uk garage", "breakbeat"],
  ambient: ["ambient", "downtempo", "trip-hop", "new age", "chillout"],
  jazz: ["jazz", "spiritual jazz", "cool jazz", "ethio-jazz"],
  soul: ["soul", "neo-soul", "r&b", "funk", "disco", "afrobeat"],
  "hip-hop": ["hip-hop", "rap", "grime"],
  rock: ["rock", "post-punk", "grunge", "shoegaze", "alternative", "new wave"],
  indie: ["indie", "dream pop", "art pop", "psychedelic"],
  folk: ["folk", "singer-songwriter", "indie folk"],
  pop: ["pop", "electropop", "dance-pop"],
  world: ["latin", "mpb", "reggae", "world", "flamenco"],
  classical: ["modern classical", "classical", "minimalism", "contemporary classical"],
};

// Favourites lean toward one style, with a couple of wildcards, the way real taste does.
function favouritesNear(leaning) {
  const words = STYLE_WORDS[leaning];
  const near = ARTISTS.filter(a => DEMO_TAGS[a].some(t => words.includes(t)));
  const rest = shuffle(ARTISTS.filter(a => !near.includes(a)));
  return [...shuffle(near).slice(0, 5), ...rest.slice(0, 2)];
}

function session(p, start, tracks, firstArtist) {
  let artist = firstArtist ?? pick(p.favourites);
  for (let i = 0, ts = start; i < tracks && ts < nowTs(); i++, ts += rand(180, 330)) {
    p.listens.push({ ts: Math.floor(ts), artist, track: "", album: "", ...(p.loves.has(artist) && Math.random() < 0.5 && { loved: true }) });
    if (Math.random() > 0.72) artist = pick(p.favourites);
  }
}

export function makeDemo(count = 100) {
  const now = nowTs(), span = 6 * 3600;
  const people = Array.from({ length: count }, (_, i) => {
    const name = FIRST[i % FIRST.length] + (i >= FIRST.length ? ` ${String.fromCharCode(65 + Math.floor(i / FIRST.length) - 1)}.` : "");
    const favourites = favouritesNear(LEANINGS[i % LEANINGS.length]);
    const p = { name, source: "demo", user: name, favourites, loves: new Set(shuffle(favourites).slice(0, 2)), listens: [] };
    session(p, now - span + rand(0, span * 0.5), Math.round(rand(4, 14)));
    if (Math.random() < 0.6) session(p, now - rand(10, 70) * 60, 40); // listening right now
    return p;
  });

  // A few small groups happen to be on the same artist right now.
  const active = shuffle(people.filter(p => p.listens.some(l => now - l.ts < 900)));
  for (let g = 0; g < Math.round(count / 20); g++) {
    const group = active.slice(g * 3, g * 3 + 2 + (g % 2));
    if (group.length < 2) break;
    const artist = pick(group[0].favourites);
    for (const p of group) session(p, now - rand(8, 25) * 60, 40, artist);
  }

  for (const p of people) {
    p.listens.sort((a, b) => b.ts - a.ts);
    if (p.listens[0] && now - p.listens[0].ts < 600) p.listens.unshift({ ...p.listens[0], ts: now, nowPlaying: true });
  }
  return people;
}

// Someone starts a song, or stops. Returns the new listen so the page can mark it.
export function demoTick(people) {
  const p = pick(people);
  for (const l of p.listens) delete l.nowPlaying;
  if (Math.random() < 0.12) return null;
  const others = people.filter(o => o !== p && o.listens.some(l => l.nowPlaying));
  const artist = others.length && Math.random() < 0.2
    ? pick(others).listens.find(l => l.nowPlaying).artist // sometimes two people land on the same artist
    : Math.random() < 0.85 ? pick(p.favourites) : pick(ARTISTS);
  const listen = { ts: nowTs(), artist, track: "", album: "", nowPlaying: true, ...(p.loves.has(artist) && Math.random() < 0.6 && { loved: true }) };
  p.listens.unshift(listen);
  return { person: p, listen };
}
