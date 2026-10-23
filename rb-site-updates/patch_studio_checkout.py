"""RB Studio checkout works again (rb-mastering-studio). Code only.

Usage: python3 -I patch_studio_checkout.py <pulled rb-mastering-studio dir>

Why: the Stripe account the studio is connected to has Stripe "Managed Payments" on by default, and Managed Payments
refuses any product without a tax code. So every studio checkout failed with "the product tax code is missing" and
nobody could buy a master or a membership (found 23 Oct 2026). The owner chose to sell without Managed Payments,
the same as the beat store and /fund on the main account: each studio checkout session now asks for
managed_payments[enabled]=false. If Stripe doesn't know that parameter (an older API version), the session is
made again without it, so this can never make checkout worse than it was.
Running it twice changes nothing.
"""
import pathlib
import sys

p = pathlib.Path(sys.argv[1]) / "index.js"
s = p.read_text(encoding="utf-8")
MARK = "managed_payments: { enabled: false }"
if MARK in s:
    print("rb-mastering-studio: checkout already sells without Managed Payments")
    raise SystemExit(0)
old = '''    try {
      const s = await stripe(env, "POST", "/v1/checkout/sessions", params);
      return json2({ url: s.url });
    } catch (e) {
      return json2({ detail: e.message }, 502);
    }'''
new = '''    try {
      // The owner sells without Stripe Managed Payments (patch_studio_checkout.py): it refuses products with no tax code.
      let s;
      try { s = await stripe(env, "POST", "/v1/checkout/sessions", { ...params, managed_payments: { enabled: false } }); }
      catch (e) { if (!/managed_payments/i.test(String(e.message))) throw e; s = await stripe(env, "POST", "/v1/checkout/sessions", params); }
      return json2({ url: s.url });
    } catch (e) {
      return json2({ detail: e.message }, 502);
    }'''
assert s.count(old) == 1, "rb-mastering-studio: the checkout call isn't where it was"
p.write_text(s.replace(old, new, 1), encoding="utf-8")
print("rb-mastering-studio: checkout sells without Managed Payments")
