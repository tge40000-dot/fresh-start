# Mastering studio: long waits in the file picker, 29 Oct 2026

**Report:** in Master (/studio/, also RB Create's Master tab), the upload "times out" when choosing a file takes too long.

**What was found:** the studio has no timer on uploads. In desktop Chromium, a file picked after 2.5 minutes in the
picker loads normally, both in /studio/ and in RB Create's Master tab. On a phone, though, the file picker sends the
browser to the background. If the picker stays open a while, the phone can close the page to free memory and reload it
on return, and the picked file is lost. That looks like a timeout.

**Fix:** `rb-site-updates/patch_studio_pick.py` (in `deploy-all.sh`), checked by `test/studio-pick.test.mjs`.
- **Picker note:** each picker (the mix, the reference track, a vault upload) is noted in the tab's session storage,
  and the note clears when a file arrives or the picker is cancelled.
- **Reload message:** if the page loads with the note still there, the phone reloaded it mid-pick. The page says so
  once, in that picker's status line, and asks for the file again, with the tip to save the file on the device first.
- **Refused reads:** the picked file is read immediately, and a read the phone refuses is tried twice more, 0.8 s
  apart. If it is still refused, the page says so in plain words.

**Checked:**
- In Chromium at phone width, these all behave as described:
  - a reload mid-pick shows the message, once;
  - a read refused once is retried and the mix loads;
  - a read refused every time ends in the plain-words message;
  - the reference-track picker is noted.
- Live at /studio/ and in /create#master: a pick after 20 s loads, a reload mid-pick shows the message, and there are
  no console errors.

**Deployed:** rb-mastering-studio `3836a209` -> **`00508493`** (code only). **Rollback:** Cloudflare > Workers >
rb-mastering-studio > Deployments > `3836a209`.
