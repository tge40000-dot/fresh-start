"""Make AI Forge beats reach RB Radio and the music player when they're published from RB Command > Create.

Usage: python3 -I patch_beat_publish.py <pulled rb-studio dir>      (RB account: CF_ACCOUNT_ID=b72a2e342f81d93bf047e568374dab0e)
       python3 -I patch_beat_publish.py <pulled rb-autopilot dir>

Why no beat had ever been published:
1. rb-studio's publish bridge called https://relentlessbillionaire.com/api/internal/studio-publish without a User-Agent.
   The main zone's browser integrity check answers such requests with its HTML challenge page (403), so the bridge
   failed with "Publishing bridge returned an invalid response" and nothing was saved.
2. The bridge saves the beat's track as status 'beat' (beat store only) with its audio on studio.relentlessbillionaire.vip,
   which the radio page may not load. The player and RB Radio only play 'live' tracks.
This
- rb-studio: sends a User-Agent and Accept header on the bridge call, and puts the HTTP status in the error if it fails again;
- rb-autopilot: before the bridge, copies the beat (and its cover) to RB's media bucket (as songs already are, so a
  failed copy publishes nothing). After the bridge, it points the beat's track at that copy and makes it live, which
  puts it in the music player and the next RB Radio rotation. It also credits the beat to the artist set on the
  publish form (default "Relentless Billionaire") instead of the bridge's default.
The beat store listing is unchanged. Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
changed = []


def patch(p, edits):
    s = p.read_text(encoding="utf-8")
    for old, new, what in edits:
        if new in s or (what == "beat to player and radio" and "beat store, music player and RB Radio" in s):
            continue  # (the beat block may since have been refined by a later edit in this list)
        if s.count(old) != 1:
            raise SystemExit(f"{folder.name}/{p.name}: {what}: anchor found {s.count(old)} times")
        s = s.replace(old, new)
        changed.append(what)
    p.write_text(s, encoding="utf-8")


if (folder / "worker.js").exists() and "studio-publish" in (folder / "worker.js").read_text(encoding="utf-8"):
    patch(folder / "worker.js", [
        ("      headers: { 'content-type': 'application/json', 'x-studio-publish-token': env.STUDIO_PUBLISH_TOKEN },\n",
         "      // The main site's browser integrity check refuses requests without a User-Agent (403 HTML challenge).\n"
         "      headers: { 'content-type': 'application/json', 'accept': 'application/json', 'user-agent': 'rb-studio (publish bridge)', 'x-studio-publish-token': env.STUDIO_PUBLISH_TOKEN },\n",
         "bridge User-Agent"),
        ("  try { result = await response.json(); } catch (_) { result = { error: 'Publishing bridge returned an invalid response.' }; }\n",
         "  try { result = await response.json(); } catch (_) { result = { error: 'Publishing bridge returned an invalid response (HTTP ' + response.status + ').' }; }\n",
         "bridge error status"),
    ])
elif (folder / "creative.js").exists():
    patch(folder / "creative.js", [
        ('      const r = await forge(env, "/api/publish/beat", { confirmed: true, audio_key: jobs.music.key, artwork_key: jobs.image && jobs.image.key, title, description, price, bpm: idea.bpm, song_key: idea.song_key });\n'
         '      where = { place: "beat store", product_id: r.productId, track_id: r.trackId, url: "https://beatstore.relentlessbillionaire.com/", price: r.price };\n',
         '      // Copy first (as songs are), so a failed copy publishes nothing; then list it in the beat store through the bridge,\n'
         '      // then point its track at RB\'s media copy and make it live: the music player and RB Radio only play live tracks on RB\'s media host.\n'
         '      const audio = await copyToMedia(env, jobs.music.key, "beats"), cover = jobs.image ? await copyToMedia(env, jobs.image.key, "covers") : null;\n'
         '      const artist = String(f.artist || "Relentless Billionaire").replace(/\\s+/g, " ").trim().slice(0, 80) || "Relentless Billionaire";\n'
         '      const r = await forge(env, "/api/publish/beat", { confirmed: true, audio_key: jobs.music.key, artwork_key: jobs.image && jobs.image.key, title, description, price, bpm: idea.bpm, song_key: idea.song_key, artist_name: artist });\n'
         '      if (r.trackId) await env.DB.prepare("UPDATE tracks SET audio_url = ?, cover_url = COALESCE(?, cover_url), artist_name = ?, status = \'live\' WHERE id = ?").bind(audio, cover, artist, r.trackId).run();\n'
         '      where = { place: "beat store, music player and RB Radio", product_id: r.productId, track_id: r.trackId, audio, cover, url: "https://beatstore.relentlessbillionaire.com/", price: r.price };\n',
         "beat to player and radio"),
        # Claim the idea before publishing, so a double-click or a retry can't publish it twice (a stale claim, e.g. a
        # crash mid-publish, can be retried after 10 minutes); a failure hands it back as ready.
        ('  if (idea.status !== "ready") return { error: idea.status === "published" ? "Already published." : "It isn\'t ready to publish yet.", status: 409 };\n',
         '  if (idea.status !== "ready" && idea.status !== "publishing") return { error: idea.status === "published" ? "Already published." : "It isn\'t ready to publish yet.", status: 409 };\n'
         '  const stale = new Date(Date.now() - 600000).toISOString().replace(/\\.\\d{3}Z$/, "Z");\n'
         '  const claim = await env.DB.prepare("UPDATE creative_ideas SET status = \'publishing\', updated_at = ? WHERE id = ? AND (status = \'ready\' OR (status = \'publishing\' AND updated_at < ?))").bind(nowIso(), id, stale).run();\n'
         '  if (!claim.meta || !claim.meta.changes) return { error: "It\'s already being published. Check again in a minute.", status: 409 };\n'
         '  const unclaim = () => env.DB.prepare("UPDATE creative_ideas SET status = \'ready\', updated_at = ? WHERE id = ? AND status = \'publishing\'").bind(nowIso(), id).run().catch(() => {});\n',
         "publish claim"),
        ('  if (!title || blocked(title, f.description)) return { error: "Add a clean title.", status: 400 };\n  let where;\n',
         '  if (!title || blocked(title, f.description)) { await unclaim(); return { error: "Add a clean title.", status: 400 }; }\n  let where, listed = null;\n',
         "publish claim released on a bad title"),
        ('      if (!(price > 0 && price <= 10000)) return { error: "Set a price between $0.01 and $10,000.", status: 400 };\n',
         '      if (!(price > 0 && price <= 10000)) { await unclaim(); return { error: "Set a price between $0.01 and $10,000.", status: 400 }; }\n',
         "publish claim released on a bad price"),
        ('      if (r.trackId) await env.DB.prepare("UPDATE tracks SET audio_url = ?, cover_url = COALESCE(?, cover_url), artist_name = ?, status = \'live\' WHERE id = ?").bind(audio, cover, artist, r.trackId).run();\n',
         '      listed = { place: "beat store", product_id: r.productId, track_id: r.trackId, url: "https://beatstore.relentlessbillionaire.com/", price: r.price };\n'
         '      if (r.trackId) await env.DB.prepare("UPDATE tracks SET audio_url = ?, cover_url = COALESCE(?, cover_url), artist_name = ?, status = \'live\' WHERE id = ?").bind(audio, cover, artist, r.trackId).run();\n',
         "remember the beat store listing"),
        ('  } catch (e) { return { error: `Publishing failed: ${clip(e.message, 240).replace(/\\.$/, "")}. Nothing was published.`, status: 502 }; }\n',
         '  } catch (e) {\n'
         '    // Listed in the beat store already: record that (so it can\'t be published twice) and say what didn\'t happen.\n'
         '    if (listed) {\n'
         '      await env.DB.prepare("UPDATE creative_ideas SET status = \'published\', published = ?, published_by = ?, published_at = ?, title = ?, updated_at = ? WHERE id = ?")\n'
         '        .bind(JSON.stringify(listed), clip(by, 120), nowIso(), title, nowIso(), id).run().catch(() => {});\n'
         '      return { error: `Listed in the beat store, but it couldn\'t be added to the music player and RB Radio (${clip(e.message, 200).replace(/\\.$/, "")}). Set its track to Live in Player.`, status: 502 };\n'
         '    }\n'
         '    await unclaim();\n'
         '    return { error: `Publishing failed: ${clip(e.message, 240).replace(/\\.$/, "")}. Nothing was published.`, status: 502 };\n'
         '  }\n',
         "honest partial-failure message"),
    ])
else:
    raise SystemExit(f"{folder.name}: not rb-studio or rb-autopilot")
print(f"{folder.name}: " + (", ".join(changed) + " updated" if changed else "beat publishing already fixed"))
