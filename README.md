# Undertow

Everyone's listening as one living ocean.

Hundreds of thousands of particles drift across a swelling, moonlit sea (GPU-simulated in
WebGL2, inspired by Refik Anadol's data paintings). Each listener is an unnamed current, and
the currents are driven by the music:

- **Styles:** every genre family (electronic, ambient, jazz, soul, hip-hop, rock, indie, folk,
  pop, world, classical) has a compass direction and a roughness. Someone's recent genres set
  which way their water flows and how choppy it is: ambient makes long glassy swirls, dance
  and rock break it into chop. People into the same styles form one river.
- **Similarity:** listeners drift toward people whose recent artists, genres and styles
  resemble theirs, so the ocean becomes a slowly shifting map of taste.
- **Song starts:** every new track surges that current and sends a ring wave out.
- **Likes:** a loved track (Last.fm loves, ListenBrainz feedback) makes its patch of sea glow.
- **In sync:** two people on the same artist within the last 12 minutes meet and orbit.

**Fur** (the button top right, or `?view=fur`) grows the same data as an endless, extremely
colourful pelt of several hundred thousand hairs running out to the horizon. The whole pelt
has one weather: everyone's styles together decide which way it is combed and how bristly it is,
and the more people are listening the harder the gusts roll across it. Each listener combs a whorl into it like a cowlick, and their listening energy makes
the fur stand up in a tuft. Calm styles lay it long and sleek, energetic ones make it short and
frizzy. A song start sends a wave rolling out through the hair all the way to the horizon, and a loved track lights the tips. Every current dyes
the fur it passes in its artist's colour, and the trail slowly grows back out to the pelt's own
drifting rainbow.

The same artist is the same colour for everyone. Now and then a single particle lights up
and names its artist in a tiny tag.

Genres come from Last.fm tags when there's an API key, otherwise from MusicBrainz (no key).

It is a static site: no backend, no build step. It runs on GitHub Pages for free.

## Try it

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. With no participants configured it shows demo data.

URL options:

- `?demo`: force demo data
- `?listeners=40`: how many demo listeners (default 100, up to 128)
- `?view=fur`: open on the fur
- `?hairs=600000`: how many strands to grow (default 420,000, 250,000 on phones)
- `?users=lb:alice,lfm:bob`: try people without editing any file (`lb` = ListenBrainz, `lfm` = Last.fm)

Drag to orbit, scroll to zoom (closer in the fur), tap the water to ripple it. Hover a current to see whose it is, what they're
playing and their closest taste match.
**Fullscreen** plus a few idle seconds (the UI fades away) gives you exhibition mode. **Save PNG** exports the frame.

## Add people

Edit `participants.json`:

```json
[
  { "name": "Pablo", "source": "lastfm", "user": "pablo_lastfm_name" },
  { "name": "Ana", "source": "listenbrainz", "user": "ana_lb" }
]
```

- **ListenBrainz** works with no key.
- **Last.fm** needs a free API key: create one at https://www.last.fm/api/account/create and paste it into
  `config.js`. It is read-only, so it is fine to have it in a public page. With a key, artists' genre tags
  also feed taste similarity (looked up once per artist and cached in the browser).
- Spotify, Apple Music and TIDAL listeners can join by scrobbling to Last.fm or ListenBrainz.
  Gramophile's vinyl scrobbles show up the same way.

Only add people who have said yes. A username in this file makes their recent listening visible on the page.

## Publish on GitHub Pages

1. Create a GitHub repo and push this folder to it.
2. Repo **Settings → Pages → Deploy from a branch → `main` / root**.
3. It will be live at `https://<you>.github.io/<repo>/` within a minute or two.

## Files

| File | What it does |
|---|---|
| `js/ocean.js` | WebGL2 ocean: the listener field, particles, swell, ripples, trails |
| `js/fur.js` | WebGL2 fur: spring-driven strands grown from the same listener field |
| `js/currents.js` | Listeners as currents: styles, likes, surges, similarity, sync |
| `js/sources.js` | Plays and likes from Last.fm / ListenBrainz, genres from Last.fm / MusicBrainz |
| `js/demo.js` | Made-up listeners for when nobody is configured |
| `js/main.js` | Loads people, polls every minute, labels, hover, export |
| `config.js` | API key, history length, poll rate, sync window |

## Next steps

- **Sign-up without editing JSON:** a GitHub Issue form ("Join the wave") plus a GitHub Action that
  adds the username to `participants.json`.
- **Long history:** a scheduled Action that fetches everyone every 15 minutes and commits `history/*.json`,
  so the wave can scroll back months, and Last.fm keys and rate limits stay out of the browser.
- **Replay:** scrub a day of everyone's listening as a time-lapse of the ocean.
- **Sound:** a soft generative drone that follows the dominant colour and energy.
- **Video export** with `canvas.captureStream()`.
