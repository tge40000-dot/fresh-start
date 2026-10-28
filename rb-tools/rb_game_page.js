// rb-game's page helpers (from version 88c5d874, 23 Oct 2026): patch_rb_game_api.py puts them back where a
// rebuild of the Worker dropped them. fixCsp widens the old game page's CSP; GAME_HEAD and GAME_ONLINE_STATUS go into
// its <head>; isGamePage picks the game page out of everything served under /game/.
function fixCsp(csp) {
  let out = String(csp || "").trim().replace(/;\s*$/, "");
  if (!out) return out;
  out = out.replace(/(^|;\s*)style-src([^;]*)/, (m, pre, list) => (/https:\/\/unpkg\.com/.test(list) ? m : `${pre}style-src${list} https://unpkg.com`));
  // Cloudflare Fonts serves the page's Google Fonts from /cf-fonts/ on this site; Web Analytics injects its beacon.
  out = out.replace(/(^|;\s*)font-src([^;]*)/, (m, pre, list) => (/'self'/.test(list) ? m : `${pre}font-src 'self'${list}`));
  out = out.replace(/(^|;\s*)script-src([^;]*)/, (m, pre, list) => (/static\.cloudflareinsights\.com/.test(list) ? m : `${pre}script-src${list} https://static.cloudflareinsights.com`));
  if (!/(^|;\s*)worker-src\s/.test(out)) out += "; worker-src 'self' blob:";
  return out + ";";
}
// 14 Oct 2026: on the game page this Worker also (a) lets people zoom the page again — the 3D city keeps its own
// pinch/drag (touch-action: none on the canvas and minimap; OrbitControls already sets it) and the HUD buttons ignore
// double-tap zoom; (b) shows a plain notice when the game's online service (InstantDB: leaderboard, city chat, other
// players, saving net worth) can't be reached, and after three failed connections tries again at most once a minute
// (or when "Try again" is pressed) instead of every few seconds; the game itself keeps running either way; (c) adds a
// description, share tags and canonical link, and stops the MapLibre and Stripe scripts from blocking first paint.
const GAME_ORIGIN = "https://relentlessbillionaire.com";
const GAME_DESC = "Relentless Billionaire — GAME. Conquer the city. Build your empire.";
const GAME_HEAD = `<meta name="description" content="${GAME_DESC}"><link rel="canonical" href="${GAME_ORIGIN}/game/">` +
  `<meta property="og:type" content="website"><meta property="og:site_name" content="Relentless Billionaire"><meta property="og:title" content="Relentless Billionaire — GAME">` +
  `<meta property="og:description" content="${GAME_DESC}"><meta property="og:url" content="${GAME_ORIGIN}/game/"><meta name="twitter:card" content="summary">` +
  `<style>#game-container,.ctrl-btn,.btn-enter,.overlay button,#radio-bar button{touch-action:manipulation}#three-canvas,#minimap{touch-action:none}` +
  `#rb-online-status{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 8px);transform:translateX(-50%);z-index:10050;width:min(92vw,440px);display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;background:#111;border:1px solid #C9A84C;color:#fff;font:13px/1.4 Inter,system-ui,sans-serif;box-shadow:0 6px 30px rgba(0,0,0,.6)}` +
  `#rb-online-status span{flex:1}#rb-online-status button{touch-action:manipulation;background:#C9A84C;color:#000;border:0;border-radius:8px;padding:8px 10px;font:700 12px Inter,system-ui,sans-serif;cursor:pointer}#rb-online-status button[data-a=close]{background:transparent;color:#fff;font-size:18px;padding:4px 8px}</style>`;
// Runs before the game's modules. Only sockets to api.instantdb.com are watched; every other WebSocket is untouched.
const GAME_ONLINE_STATUS = `<script>(function(){var N=window.WebSocket;if(!N||N.__rb)return;var fails=0,hold=0,el=null,dismissed=false,MSG="Online features are unavailable right now: the leaderboard, city chat and other players can\\u2019t connect, and your net worth isn\\u2019t being saved online. You can keep playing.";
function instant(u){try{return new URL(String(u),location.href).hostname==="api.instantdb.com"}catch(e){return false}}
function lb(on){var l=document.getElementById("lb-list");if(!l)return;if(on&&!l.children.length){var d=document.createElement("div");d.className="lb-item";d.setAttribute("data-rb-offline","");d.textContent="Leaderboard offline";l.appendChild(d)}if(!on){var o=l.querySelector("[data-rb-offline]");if(o)o.remove()}}
function show(on){if(!document.body){document.addEventListener("DOMContentLoaded",function(){show(on)});return}lb(on);if(!on){if(el){el.remove();el=null}dismissed=false;return}if(el||dismissed)return;
el=document.createElement("div");el.id="rb-online-status";el.setAttribute("role","status");el.innerHTML='<span></span><button type="button" data-a="retry">Try again</button><button type="button" data-a="close" aria-label="Dismiss">\\u00d7</button>';el.firstChild.textContent=MSG;
el.addEventListener("click",function(e){var a=e.target&&e.target.getAttribute&&e.target.getAttribute("data-a");if(a==="retry"){hold=0;el.firstChild.textContent="Trying again\\u2026"}if(a==="close"){dismissed=true;el.remove();el=null}});document.body.appendChild(el)}
function failed(){fails++;if(fails>=3){hold=Date.now()+60000;show(true);if(el)el.firstChild.textContent=MSG}}
function Fake(u){var t=new EventTarget();t.url=String(u);t.readyState=0;t.protocol="";t.extensions="";t.bufferedAmount=0;t.binaryType="blob";t.send=function(){throw new DOMException("Still in CONNECTING state.","InvalidStateError")};t.close=function(){};
setTimeout(function(){t.readyState=3;var e=new Event("error");t.dispatchEvent(e);if(t.onerror)t.onerror(e);var c=new CloseEvent("close",{code:1006,wasClean:false});t.dispatchEvent(c);if(t.onclose)t.onclose(c)},0);return t}
function W(u,p){if(!instant(u))return p===undefined?new N(u):new N(u,p);if(fails>=3&&Date.now()<hold)return new Fake(u);var ws=p===undefined?new N(u):new N(u,p),opened=false;
ws.addEventListener("open",function(){opened=true;fails=0;hold=0;show(false)});ws.addEventListener("close",function(){if(!opened)failed()});return ws}
W.prototype=N.prototype;["CONNECTING","OPEN","CLOSING","CLOSED"].forEach(function(k){W[k]=N[k]});W.__rb=true;window.WebSocket=W})();</script>`;
function isGamePage(request) { return /^\/game\/(index\.html)?$/.test(new URL(request.url).pathname); }
