import { CONFIG } from "../config.js";

// Every source returns listens shaped as
// { ts: unix seconds, artist, track, album, nowPlaying?: true, loved?: true }

export async function fetchListens(person, sinceTs) {
  switch (person.source) {
    case "lastfm": return lastfm(person.user, sinceTs);
    case "listenbrainz": return listenbrainz(person.user, sinceTs);
    default: throw new Error(`Unknown source "${person.source}"`);
  }
}

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(e => {
    throw new Error(e.name === "TimeoutError" ? "timed out" : "network error");
  });
  if (res.status === 404) throw new Error("user not found");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const nowTs = () => Math.floor(Date.now() / 1000);
const songKey = (artist, track) => `${artist}|${track}`.toLowerCase();

async function listenbrainz(user, sinceTs) {
  const base = `https://api.listenbrainz.org/1/user/${encodeURIComponent(user)}`;
  const [history, playing, feedback] = await Promise.all([
    getJSON(`${base}/listens?count=1000&min_ts=${sinceTs}`),
    getJSON(`${base}/playing-now`).catch(() => null),
    getJSON(`https://api.listenbrainz.org/1/feedback/user/${encodeURIComponent(user)}/get-feedback?score=1&count=500&metadata=true`).catch(() => null),
  ]);
  const loved = new Set((feedback?.feedback ?? [])
    .map(f => f.track_metadata && songKey(f.track_metadata.artist_name, f.track_metadata.track_name))
    .filter(Boolean));
  const listen = (m, extra) => ({
    artist: m.artist_name,
    track: m.track_name,
    album: m.release_name || "",
    ...(loved.has(songKey(m.artist_name, m.track_name)) && { loved: true }),
    ...extra,
  });
  const listens = history.payload.listens.map(l => listen(l.track_metadata, { ts: l.listened_at }));
  const np = playing?.payload?.listens?.[0]?.track_metadata;
  if (np) listens.unshift(listen(np, { ts: nowTs(), nowPlaying: true }));
  return listens;
}

// Genre tags drive the style of each current and enrich taste similarity.
// From Last.fm when there's a key, otherwise MusicBrainz (no key, one request a second).
// Looked up once per artist and remembered in the browser.
const TAGS_KEY = "undertow-tags-v1";
let tagCache;
try { tagCache = new Map(Object.entries(JSON.parse(localStorage.getItem(TAGS_KEY) || "{}"))); } catch { tagCache = new Map(); }
const tagQueue = [];
let tagTimer = null;

export function artistTags(artist) {
  const k = (artist || "").toLowerCase();
  if (tagCache.has(k)) return tagCache.get(k);
  tagCache.set(k, null);
  if (k) {
    tagQueue.push([k, artist]);
    tagTimer ??= setInterval(lookUpNextTag, CONFIG.lastfmApiKey ? 250 : 1100);
  }
  return null;
}

async function lookUpNextTag() {
  const next = tagQueue.shift();
  if (!next) { clearInterval(tagTimer); tagTimer = null; return; }
  const [k, artist] = next;
  try {
    let tags;
    if (CONFIG.lastfmApiKey) {
      const data = await getJSON("https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&autocorrect=1&format=json"
        + `&artist=${encodeURIComponent(artist)}&api_key=${CONFIG.lastfmApiKey}`);
      tags = [].concat(data.toptags?.tag ?? []).slice(0, 5).map(t => t.name);
    } else {
      const data = await getJSON(`https://musicbrainz.org/ws/2/artist/?fmt=json&limit=1&query=${encodeURIComponent(`artist:"${artist}"`)}`);
      tags = (data.artists?.[0]?.tags ?? []).sort((a, b) => b.count - a.count).slice(0, 5).map(t => t.name);
    }
    tagCache.set(k, tags.map(t => t.toLowerCase()));
    try { localStorage.setItem(TAGS_KEY, JSON.stringify(Object.fromEntries([...tagCache].filter(([, v]) => v)))); } catch {}
  } catch {
    tagCache.set(k, []);
  }
}

async function lastfm(user, sinceTs) {
  if (!CONFIG.lastfmApiKey) throw new Error("add a Last.fm API key in config.js");
  const listens = [];
  for (let page = 1, pages = 1; page <= Math.min(pages, 5); page++) {
    const url = "https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&format=json&limit=200&extended=1"
      + `&user=${encodeURIComponent(user)}&api_key=${CONFIG.lastfmApiKey}&from=${sinceTs}&page=${page}`;
    const data = await getJSON(url);
    if (data.error) throw new Error(data.message);
    pages = Number(data.recenttracks["@attr"]?.totalPages || 1);
    const tracks = [].concat(data.recenttracks.track ?? []);
    for (const t of tracks) {
      const np = t["@attr"]?.nowplaying === "true";
      listens.push({
        ts: np ? nowTs() : Number(t.date.uts),
        artist: t.artist["#text"] ?? t.artist.name,
        track: t.name,
        album: t.album?.["#text"] || "",
        ...(np && { nowPlaying: true }),
        ...(t.loved === "1" && { loved: true }),
      });
    }
  }
  return listens;
}
