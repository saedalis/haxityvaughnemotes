// Cross-browser: Firefox exposes `browser` (promises); Chrome exposes `chrome`.
const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = { chatSelector: "", sevenTvSetId: "01H3ZQJDPG000FFX1CY9011KZQ", twitchId: "42649203", ffzChannel: "haxitydota", useGlobals: true, emoteSize: 32, autocomplete: true };
const textIds = ["chatSelector", "twitchId", "sevenTvSetId", "ffzChannel", "emoteSize"];
const boolIds = ["useGlobals", "autocomplete"];
const $ = (id) => document.getElementById(id);

// Only touch fields that exist on the page, so removing a field from options.html is safe.
function fill(s) {
  textIds.forEach((id) => { if ($(id)) $(id).value = s[id]; });
  boolIds.forEach((id) => { if ($(id)) $(id).checked = s[id]; });
}
ext.storage.sync.get(DEFAULTS).then(fill);

// Clears anything saved earlier (e.g. a blank Twitch ID) so the built-in defaults apply again.
$("reset").onclick = async () => {
  await ext.storage.sync.clear();
  await ext.storage.local.remove("cache");
  fill(DEFAULTS);
  $("status").textContent = "Reset to defaults.";
};

$("save").onclick = async () => {
  const s = {};
  textIds.forEach((id) => { if ($(id)) s[id] = $(id).value.trim(); });
  boolIds.forEach((id) => { if ($(id)) s[id] = $(id).checked; });
  await ext.storage.sync.set(s);
  await ext.storage.local.remove("cache");
  $("status").textContent = "Saved.";
};
