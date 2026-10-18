// Serves studio.relentlessbillionaire.com's page and /daw/ assets from a local rb-daw dir (Playwright route); everything else is live.
// Serve studio.relentlessbillionaire.com from a local rb-daw build (document + /daw/ assets); everything else live.
export async function routeStudio(page, dir) {
  const w = (await import(dir + '/index.js')).default;
  await page.route(/^https:\/\/studio\.relentlessbillionaire\.com\/(\?.*)?(daw\/.*)?$/, async (route) => {
    const req = route.request();
    const res = await w.fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), { DEV: '0' }, { waitUntil() {} });
    const headers = {}; res.headers.forEach((v, k) => headers[k] = v);
    await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  });
}
