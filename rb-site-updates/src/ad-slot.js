/* RB ad slot: sponsored cards for any RB page, served by the main site at /api/ads/slot.js (with /api/ads/slot.css).
   A page adds <section class="rb-ad-slot" data-rb-ads="radio" hidden></section> and this script. It asks
   /api/ads for that surface (radio, tv or home; ads set to "everywhere" come too) and shows up to two cards, marked
   Sponsored. Nothing shows if no ad is live. The same rules as the homepage rails apply: one daily cap per visitor
   across every RB page; a view is counted when the card is drawn, "viewable" after half of it has been on screen for
   1 second (2 for video); video plays muted, only while on screen, and never for reduced-motion or data-saver
   visitors; clicks go through /go/ad/<id>, which keeps the advertiser's link as it is. */
(function () {
  var slots = [].slice.call(document.querySelectorAll("[data-rb-ads]"));
  if (!slots.length || !window.fetch) return;
  var Q = [], T = null, SEEN = {}, IO = null;
  var CALM = (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) || (navigator.connection && navigator.connection.saveData);
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function send(id, kind) { Q.push({ id: Number(id), kind: kind }); clearTimeout(T); T = setTimeout(flush, 700); }
  function flush() {
    if (!Q.length) return;
    var body = JSON.stringify({ events: Q.splice(0, 24) });
    try { if (navigator.sendBeacon && navigator.sendBeacon("/api/ads/event", body)) return; } catch (e) {}
    fetch("/api/ads/event", { method: "POST", body: body, keepalive: true }).catch(function () {});
  }
  function cap() {
    var d = new Date().toISOString().slice(0, 10);
    try { var c = JSON.parse(localStorage.getItem("rbAdCap") || "{}"); return c && c.d === d && c.n ? c : { d: d, n: {} }; } catch (e) { return { d: d, n: {} }; }
  }
  function capAdd(id, n) { try { var c = cap(), v = c.n[id] || [0, n || 3]; v[0]++; v[1] = n || v[1] || 3; c.n[id] = v; localStorage.setItem("rbAdCap", JSON.stringify(c)); } catch (e) {} }
  function skip() { var c = cap(), out = []; for (var k in c.n) { if (c.n[k][1] > 0 && c.n[k][0] >= c.n[k][1]) out.push(k); } return out.join(","); }
  function media(a) {
    if (a.format === "video" && a.video_url) return '<div class="rbad-media"><video muted playsinline loop preload="none"' + (a.poster_url ? ' poster="' + esc(a.poster_url) + '"' : "") + ' src="' + esc(a.video_url) + '"></video></div>';
    return a.image_url ? '<div class="rbad-media"><img src="' + esc(a.image_url) + '" alt="" loading="lazy" decoding="async"></div>' : "";
  }
  function card(a) {
    var href = a.click ? esc(a.click) : "", open = '<a href="' + href + '" target="_blank" rel="sponsored noopener"';
    var m = media(a), head = esc(a.headline || a.advertiser);
    if (href && m && a.format !== "video") m = open + ' tabindex="-1" aria-hidden="true">' + m + "</a>";
    return '<article class="rbad-card" data-adcard="' + a.id + '" data-adcap="' + (a.freq_cap || 0) + '" data-format="' + (a.format === "video" ? "video" : "image") + '">' + m +
      '<div class="rbad-body"><h3 class="rbad-head">' + (href ? open + ">" + head + "</a>" : head) + "</h3>" +
      (a.body ? '<p class="rbad-text">' + esc(a.body) + "</p>" : "") +
      (href && a.cta ? open + ' class="rbad-cta">' + esc(a.cta) + " &rarr;</a>" : "") +
      '<p class="rbad-tag">Sponsored &middot; ' + esc(a.advertiser) + "</p></div></article>";
  }
  function play(v) { if (!v || CALM) return; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  function watch(c) {
    var id = c.getAttribute("data-adcard"), n = Number(c.getAttribute("data-adcap")) || 0, video = c.getAttribute("data-format") === "video", v = c.querySelector("video");
    if (!c.getClientRects().length) return;
    if (!SEEN[id + "i"]) { SEEN[id + "i"] = 1; send(id, "imp"); capAdd(id, n); }
    if (v) {
      v.addEventListener("playing", function () { if (!SEEN[id + "s"]) { SEEN[id + "s"] = 1; send(id, "start"); } });
      v.addEventListener("timeupdate", function () { if (v.duration && v.currentTime / v.duration > 0.97 && !SEEN[id + "c"]) { SEEN[id + "c"] = 1; send(id, "complete"); } });
    }
    if (!("IntersectionObserver" in window)) return;
    IO = IO || new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var t = e.target, tid = t.getAttribute("data-adcard"), tv = t.querySelector("video"), isVid = t.getAttribute("data-format") === "video";
        t.__in = e.intersectionRatio >= 0.5;
        if (t.__in) {
          play(tv);
          if (!SEEN[tid + "v"] && !t.__t) t.__t = setTimeout(function () { t.__t = null; if (t.__in && !SEEN[tid + "v"]) { SEEN[tid + "v"] = 1; send(tid, "view"); } }, isVid ? 2000 : 1000);
        } else {
          if (tv) { try { tv.pause(); } catch (x) {} }
          if (t.__t) { clearTimeout(t.__t); t.__t = null; }
        }
      });
    }, { threshold: [0, 0.5] });
    IO.observe(c);
  }
  slots.forEach(function (slot) {
    var surface = (slot.getAttribute("data-rb-ads") || "all").replace(/[^a-z]/g, ""), max = Math.min(Number(slot.getAttribute("data-rb-ads-max")) || 2, 4);
    fetch("/api/ads?slot=rail&surface=" + surface + "&skip=" + skip(), { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) {
      var ads = (d.ads || []).slice(0, max);
      if (!ads.length) return;
      slot.setAttribute("aria-label", "Sponsored");
      slot.innerHTML = '<p class="rbad-kick">Sponsored</p><div class="rbad-row">' + ads.map(card).join("") + "</div>";
      slot.hidden = false;
      [].slice.call(slot.querySelectorAll("img")).forEach(function (img) { img.addEventListener("error", function () { var m = img.closest(".rbad-media"); if (m) m.parentNode.removeChild(m); }); });
      [].slice.call(slot.querySelectorAll("[data-adcard]")).forEach(watch);
    }).catch(function () {});
  });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { flush(); [].slice.call(document.querySelectorAll(".rbad-card video")).forEach(function (v) { try { v.pause(); } catch (e) {} }); } });
  window.addEventListener("pagehide", flush);
})();
