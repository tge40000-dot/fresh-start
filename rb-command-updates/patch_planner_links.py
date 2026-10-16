"""Show planner follow-up: a counted link on every post. Apply after patch_show_planner.py.

Usage: python3 -I patch_planner_links.py <pulled rb-command dir>

Each post in a plan's content calendar gets a link like relentlessbillionaire.com/go/post/42?c=instagram (for the bio
or a story link sticker), a Copy link button and its click count. The main site (artist-router, see
../rb-site-updates) counts the clicks and sends people to /events with UTM tags. Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])


def edit(name, old, new):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    # Already done? For an insertion, look for the inserted text on its own: another patch may have added its own
    # block next to the same anchor since, so "anchor + block" isn't side by side any more.
    added = new[len(old):] if new.startswith(old) else new[: len(new) - len(old)] if new.endswith(old) else None
    if added and s.count(added) > 1:
        # An earlier version of these scripts could add a block twice. Keep the first copy, drop the rest.
        first = s.index(added) + len(added)
        s = s[:first] + s[first:].replace(added, "")
        p.write_text(s, encoding="utf-8")
        print(f"{name}: removed a duplicate copy")
    # A later patch may have edited the block since (see patch_planner_links.py): its first line still marks it as done.
    # The whole first line, indentation included, so one block's first line can't match a look-alike line elsewhere.
    mark = next((ln for ln in added.split("\n") if ln.strip()), "") if added else ""
    if new in s or (added and added in s) or (len(mark.strip()) >= 25 and ("\n" + mark + "\n") in ("\n" + s)):
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: edited")


edit("ui.js", '''  function viewShows(params){\n''',
     '''  // The post's counted link: the main site adds one to its clicks and sends people to /events with UTM tags.
  function postLink(i){ var c = (String(i.channel || "").toLowerCase().match(/instagram|tiktok|threads|facebook|youtube|email/) || ["social"])[0]; return "https://relentlessbillionaire.com/go/post/" + i.id + "?c=" + c; }
  function viewShows(params){\n''')
edit("ui.js", '''(i.kind === "content" ? '<button class="btn" type="button" data-copy-cap>Copy caption</button>' : "")''',
     '''(i.kind === "content" ? '<button class="btn" type="button" data-copy-cap>Copy caption</button><button class="btn" type="button" data-copy-link>Copy link</button>' : "")''')
edit("ui.js", '''(i.kind === "content" ? '<li class="spsub"><pre class="note pre grow">' + esc(i.body || "") + "</pre></li>" : "")''',
     '''(i.kind === "content" ? '<li class="spsub"><div class="grow"><pre class="note pre">' + esc(i.body || "") + '</pre><div class="muted">Link for your bio or a story link sticker: ' + esc(postLink(i)) + " · " + num(i.clicks || 0) + " click" + (Number(i.clicks) === 1 ? "" : "s") + "</div></div></li>" : "")''')
edit("ui.js", '''      if (b.hasAttribute("data-copy-cap")) {''',
     '''      if (b.hasAttribute("data-copy-link")) { var il = d.items.find(function(x){ return String(x.id) === li.dataset.item; }); copyText(postLink(il), "Link copied. Each click is counted on this post."); return; }
      if (b.hasAttribute("data-copy-cap")) {''')
print("rb-command patched")
