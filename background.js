// Fetches and caches emote lists. Returns a plain object: name -> { url, zw }
// Cross-browser: Firefox exposes `browser` (promises); Chrome exposes `chrome`.
const ext = globalThis.browser ?? globalThis.chrome;

const TTL_MS = 30 * 60 * 1000;

const DEFAULTS = {
  chatSelector: "",       // CSS selector for the chat message list (see README)
  sevenTvSetId: "01H3ZQJDPG000FFX1CY9011KZQ", // default 7TV emote set
  twitchId: "42649203",   // numeric Twitch user ID (loads BTTV + 7TV + FFZ channel emotes)
  useGlobals: true,
  ffzChannel: "haxitydota", // FrankerFaceZ channel name (the part after /channel/ on frankerfacez.com)
  emoteSize: 32,          // emote height in px
  autocomplete: true      // ":" emote picker in the chat input
};

async function getSettings() {
  const s = { ...DEFAULTS, ...(await ext.storage.sync.get(DEFAULTS)) };
  // A blank saved value means "use the default" (so an old blank save can't override it).
  // Type "none" in a field to turn that source off on purpose.
  for (const k of ["twitchId", "ffzChannel", "sevenTvSetId"]) {
    let v = String(s[k] == null ? "" : s[k]).trim();
    if (!v) v = DEFAULTS[k];
    else if (/^(none|off|-)$/i.test(v)) v = "";
    s[k] = v;
  }
  return s;
}

// Fetch JSON and record the outcome of every request in `log` (shown in the page console).
async function getJson(url, log) {
  const name = url.replace("https://", "");
  try {
    const r = await fetch(url);
    if (!r.ok) { log && log.push({ request: name, status: "HTTP " + r.status }); return null; }
    const data = await r.json();
    log && log.push({ request: name, status: "ok" });
    return data;
  } catch (e) {
    console.warn("[VL Emotes] fetch failed", url, e);
    log && log.push({ request: name, status: "error: " + (e && e.message || e) });
    return null;
  }
}

// Add one emote and remember which source it came from (src) so we can report per-source counts.
function add(out, stats, src, name, url, zw) {
  out[name] = { url, zw, src };
  stats[src] = (stats[src] || 0) + 1; // "fetched" count, before name collisions overwrite anything
}

// 7TV: emote object -> entry. Zero-width flag is bit 256 on data.flags.
function from7tvSet(set, out, stats, src) {
  if (!set || !set.emotes) return;
  for (const e of set.emotes) {
    const flags = (e.data && e.data.flags) || 0;
    add(out, stats, src, e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`, (flags & 256) !== 0);
  }
}

function fromBttvList(list, out, stats, src) {
  if (!Array.isArray(list)) return;
  for (const e of list) {
    add(out, stats, src, e.code, `https://cdn.betterttv.net/emote/${e.id}/2x.webp`, false);
  }
}

// FrankerFaceZ: emote object -> entry. Prefers the animated image when one exists.
function ffzImage(e) {
  const pick = (o) => o && (o["2"] || o["4"] || o["1"]);
  const u = pick(e.animated) || pick(e.urls);
  if (!u) return null;
  return u.startsWith("//") ? "https:" + u : u;
}

function fromFfzSets(sets, out, stats, src, onlyIds) {
  if (!sets) return;
  const list = onlyIds ? onlyIds.map((id) => sets[id]) : Object.values(sets);
  for (const set of list) {
    if (!set || !Array.isArray(set.emoticons)) continue;
    for (const e of set.emoticons) {
      if (e.modifier) continue; // FFZ modifier emotes (flip, wide, ...) aren't standalone images
      const url = ffzImage(e);
      if (url) add(out, stats, src, e.name, url, false);
    }
  }
}

async function buildEmotes(s, stats = {}, log = []) {
  const getJ = (url) => getJson(url, log);
  // Lowest priority first; later writes overwrite earlier ones.
  const out = {};

  if (s.useGlobals) {
    // FFZ global: only the "default" sets apply to everyone.
    const fg = await getJ("https://api.frankerfacez.com/v1/set/global");
    if (fg) fromFfzSets(fg.sets, out, stats, "FFZ global", fg.default_sets);
    fromBttvList(await getJ("https://api.betterttv.net/3/cached/emotes/global"), out, stats, "BTTV global");
    const g7 = await getJ("https://7tv.io/v3/emote-sets/global");
    from7tvSet(g7, out, stats, "7TV global");
  }

  // FFZ channel by name, and by Twitch ID if one is set.
  if (s.ffzChannel) {
    const f = await getJ(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(s.ffzChannel.toLowerCase())}`);
    if (f) fromFfzSets(f.sets, out, stats, "FFZ channel");
  }
  if (s.twitchId) {
    const f = await getJ(`https://api.frankerfacez.com/v1/room/id/${encodeURIComponent(s.twitchId)}`);
    if (f) fromFfzSets(f.sets, out, stats, "FFZ channel");
  }

  if (s.twitchId) {
    const b = await getJ(`https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(s.twitchId)}`);
    if (b) {
      fromBttvList(b.channelEmotes, out, stats, "BTTV channel");
      fromBttvList(b.sharedEmotes, out, stats, "BTTV channel");
    }
    const u = await getJ(`https://7tv.io/v3/users/twitch/${encodeURIComponent(s.twitchId)}`);
    if (u && u.emote_set) from7tvSet(u.emote_set, out, stats, "7TV channel");
  }

  if (s.sevenTvSetId) {
    from7tvSet(await getJ(`https://7tv.io/v3/emote-sets/${encodeURIComponent(s.sevenTvSetId)}`), out, stats, "7TV set");
  }

  return out;
}

async function getEmotes() {
  const s = await getSettings();
  const key = JSON.stringify(["v2", s.sevenTvSetId, s.twitchId, s.useGlobals, s.ffzChannel]);
  const { cache } = await ext.storage.local.get("cache");
  if (cache && cache.key === key && Date.now() - cache.t < TTL_MS) {
    return { emotes: cache.emotes, fetched: cache.fetched, requests: cache.requests, settings: cache.settings, chatSelector: s.chatSelector, emoteSize: s.emoteSize, autocomplete: s.autocomplete };
  }
  const fetched = {}, requests = [];
  const settings = { twitchId: s.twitchId, ffzChannel: s.ffzChannel, sevenTvSetId: s.sevenTvSetId, useGlobals: s.useGlobals };
  const emotes = await buildEmotes(s, fetched, requests);
  console.log("[VLE bg] built", Object.keys(emotes).length, "emotes", fetched, requests, "with settings", s);
  await ext.storage.local.set({ cache: { key, t: Date.now(), emotes, fetched, requests, settings } });
  return { emotes, fetched, requests, settings, chatSelector: s.chatSelector, emoteSize: s.emoteSize, autocomplete: s.autocomplete };
}

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getEmotes") {
    getEmotes().then(sendResponse);
    return true; // async response
  }
});
