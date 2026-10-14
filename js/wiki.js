// Wikipedia, live: every language edition is a current, every edit to an article flows into it.
//
// Edits arrive from Wikimedia's public EventStreams feed (no key, open to any web page):
// https://stream.wikimedia.org/v2/stream/recentchange
//
// - A language's edit rate is its energy. The articles it is editing most colour it, each
//   title with its own colour, the way each artist has one.
// - Languages of one family flow in one direction, so they form one river; bot edits pull
//   toward their own direction and roughen the water.
// - New articles and big edits by people send a wave out and name the article; a new
//   article makes its patch glow. Bots and scripts shape the water but never get a title.
// - The same article edited by people in two languages at once (usually news) brings them together.
//
// Only main-namespace article edits are used. Editors' names and comments are never shown.

const STREAM = "https://stream.wikimedia.org/v2/stream/recentchange";
const REPLAY = 5 * 60;   // on load, replay the last few minutes so the page starts full
const KEEP = 10 * 60;    // edits older than this have washed out
const EDITING = 90;      // a language counts as "editing now" this long after an edit

export const WIKI_STYLES = [
  { name: "germanic", chop: 0.45, words: ["en", "simple", "de", "nl", "sv", "da", "no", "nn", "is", "af", "lb", "fy", "als", "yi", "li", "nds", "fo", "sco", "bar"] },
  { name: "romance", chop: 0.35, words: ["fr", "es", "it", "pt", "ro", "ca", "gl", "oc", "la", "an", "ast", "vec", "scn", "nap", "lmo", "pms", "co", "rm", "wa", "eo", "ia"] },
  { name: "slavic", chop: 0.55, words: ["ru", "pl", "uk", "cs", "sk", "sr", "hr", "bs", "sh", "bg", "mk", "sl", "be", "be-tarask", "rue", "csb", "hsb", "dsb"] },
  { name: "east asian", chop: 0.6, words: ["zh", "ja", "ko", "zh-yue", "yue", "wuu", "zh-classical", "lzh", "gan", "zh-min-nan", "nan", "mn", "bo"] },
  { name: "south asian", chop: 0.4, words: ["hi", "bn", "ta", "te", "ur", "mr", "ml", "kn", "gu", "pa", "pnb", "ne", "si", "or", "as", "sa", "bh", "new", "sd", "mai"] },
  { name: "middle eastern", chop: 0.5, words: ["ar", "fa", "he", "arz", "ary", "ckb", "ku", "ps", "azb", "mzn", "glk", "lrc", "dv"] },
  { name: "turkic", chop: 0.5, words: ["tr", "az", "kk", "uz", "ky", "tt", "ba", "tk", "cv", "sah", "crh", "ug"] },
  { name: "southeast asian", chop: 0.3, words: ["id", "ms", "vi", "th", "tl", "jv", "su", "ceb", "war", "min", "km", "lo", "my", "bcl", "ilo", "pag", "bjn", "ban"] },
  { name: "african", chop: 0.4, words: ["sw", "yo", "ha", "ig", "zu", "xh", "am", "so", "rw", "ln", "wo", "om", "ti", "mg", "sn", "ny", "tw", "kab", "shi"] },
  { name: "uralic & other european", chop: 0.3, words: ["fi", "et", "hu", "lt", "lv", "el", "hy", "ka", "sq", "eu", "cy", "ga", "gd", "br", "kw", "gv", "se", "smn", "mt", "ce", "os", "ab", "udm", "kv", "mhr"] },
  { name: "bots", chop: 0.95, words: ["bot"] },
];
const FAMILY = new Map(WIKI_STYLES.flatMap(s => s.words.map(w => [w, s.name])));

let names;
try { names = new Intl.DisplayNames(["en"], { type: "language" }); } catch { names = null; }
function languageName(code) {
  if (code === "simple") return "Simple English";
  try {
    const n = names?.of(code);
    if (n && n.toLowerCase() !== code) return n;
  } catch {}
  return code;
}

// Is this a person at work? Not a flagged bot, not an account named as one, and not a
// scripted or mass-editing tool (those sign their summaries "Bot:", or with AWB / JWB).
const BOT_NAME = /Bot\b|BOT\b|\b[Bb]ot\b/; // InternetArchiveBot, ClueBot NG, AnomieBOT; not Talbot or Botany
const AUTOMATED = /^\s*(ro)?bot\b|\bbot:|\[\[\s*(wp|wikipedia|project)\s*:\s*(awb|jwb)|\bAutoWikiBrowser\b|\bJWB\b|\(AWB\)|using AWB/i;
export const isHuman = ev => !ev.bot && !BOT_NAME.test(ev.user ?? "") && !AUTOMATED.test(ev.comment ?? "");

// Automated edits flow with the bots, everyone else with their language's family.
export const wikiTags = (_title, edit) => edit?.tags ?? null;

export class WikiFeed {
  // onEdit(person, edit, replayed): called for every article edit as it arrives.
  constructor(onEdit, max = 120) {
    this.onEdit = onEdit;
    this.max = max;
    this.byWiki = new Map();
    this.minute = [];      // arrival times, for the edits-a-minute count
    this.error = null;
  }

  start() {
    const since = new Date(Date.now() - REPLAY * 1000).toISOString();
    this.source = new EventSource(`${STREAM}?since=${encodeURIComponent(since)}`);
    this.source.onopen = () => { this.error = null; };
    this.source.onerror = () => { this.error = "reconnecting to Wikipedia"; }; // EventSource retries by itself
    this.source.onmessage = e => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      this.receive(ev);
    };
  }

  receive(ev) {
    if (ev.namespace !== 0 || (ev.type !== "edit" && ev.type !== "new")) return;
    const m = /^([a-z-]+)\.wikipedia\.org$/.exec(ev.server_name ?? "");
    if (!m || !ev.title || !ev.timestamp) return;
    const lang = m[1];
    let p = this.byWiki.get(ev.wiki);
    if (!p) {
      p = { name: languageName(lang), source: "wikipedia", user: ev.wiki, lang, listens: [], loaded: true };
      this.byWiki.set(ev.wiki, p);
    }
    const delta = (ev.length?.new ?? 0) - (ev.length?.old ?? 0);
    const human = isHuman(ev);
    const edit = {
      ts: ev.timestamp,
      artist: ev.title,
      track: ev.type === "new" ? "new article" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("en")} bytes`,
      album: "",
      nowPlaying: true,
      ...(ev.type === "new" && human && { loved: true }),
      tags: [human ? FAMILY.get(lang) ?? "uralic & other european" : "bot"],
      bot: !human,
      isNew: ev.type === "new",
      delta,
    };
    for (const l of p.listens) if (l.nowPlaying) delete l.nowPlaying; else break;
    p.listens.unshift(edit);
    const replayed = Date.now() / 1000 - ev.timestamp > 30;
    if (!replayed) this.minute.push(Date.now());
    this.onEdit(p, edit, replayed);
  }

  // Lets old edits wash out, and returns the busiest languages, the ones to show.
  people(now) {
    for (const p of this.byWiki.values()) {
      let keep = p.listens.length;
      while (keep && now - p.listens[keep - 1].ts > KEEP) keep--;
      p.listens.length = keep;
      if (p.listens[0]?.nowPlaying && now - p.listens[0].ts > EDITING) delete p.listens[0].nowPlaying;
    }
    const cut = Date.now() - 60000;
    while (this.minute.length && this.minute[0] < cut) this.minute.shift();
    return [...this.byWiki.values()]
      .filter(p => p.listens.length)
      .sort((a, b) => b.listens.length - a.listens.length)
      .slice(0, this.max);
  }

  get perMinute() {
    return this.minute.length;
  }
}

// How the page talks about this feed.
export const WIKI_TIMING = {
  styles: WIKI_STYLES,
  recent: KEEP,
  halfLife: 120,
  sharedMinutes: 10,
  syncRecent: 300,
  syncHalfLife: 180,
  energy: activity => 0.2 * Math.log1p(activity),
};
