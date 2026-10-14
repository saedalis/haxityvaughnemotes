# Uncxity Emotes in Vaughn (7TV + BTTV)

Works in Chrome and Firefox.

## Install: Chrome
chrome://extensions > Developer mode > Load unpacked > pick this folder.

## Install: Firefox
1. about:debugging > This Firefox > Load Temporary Add-on > pick manifest.json.
   (Temporary add-ons are removed when Firefox closes.)
2. IMPORTANT: Firefox does not grant site access automatically.
   Open about:addons > this extension > Permissions and turn on access to
   vaughn.live, 7tv.io, api.betterttv.net and api.frankerfacez.com. Then reload the vaughn.live tab.
3. For a permanent install, sign it (free, "unlisted") at addons.mozilla.org.
   Zip the *contents* of this folder (manifest.json must be at the zip root).

## Chat selector
Defaults to `.vs_chatv9_msg_body`. Add a "chatSelector" field to options.html only if the site changes its markup.
