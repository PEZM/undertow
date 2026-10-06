export const CONFIG = {
  // Free key from https://www.last.fm/api/account/create. It is read-only and
  // fine to ship in a public page. ListenBrainz needs no key at all.
  // With a key, artists' genre tags also feed the taste map.
  lastfmApiKey: "",

  historyHours: 6,      // how far back someone's taste is read
  pollSeconds: 60,      // how often to look for new plays
  sharedMinutes: 45,    // two people on the same artist this close together meet and orbit
};
