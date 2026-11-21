# QGenda Improver

Re-publishes a QGenda iCal subscription with each shift's hospital location, coordinates and
Apple travel-time flag added, so iOS can show "Time to Leave". An optional "arrive early"
offset moves the event start earlier (the real shift time is kept in the notes).

- `src/transform.mjs`: the ICS transform (pure, no I/O)
- `src/sites.json`: sites, addresses, coordinates and the title-matching rules. Edit this to add sites.
- `worker/`: Cloudflare Worker serving `/cal?k=<qgenda key>&early=<min>&travel=0|1`
- `docs/`: static web page (GitHub Pages) that builds the subscription link
- `test/`: `QGENDA_FEED=/path/to/feed.ics node --test test/`

## Deploy

1. **Worker** (free Cloudflare account):
   ```bash
   cd worker && npx wrangler login && npx wrangler deploy
   ```
   Note the printed `https://qgenda-improver.<you>.workers.dev` address.
2. Put that address in `WORKER` near the bottom of `docs/index.html`.
3. **Pages**: push this repo to GitHub, then Settings → Pages → deploy from branch `main`, folder `/docs`.

## Privacy

The QGenda key is the only credential and travels inside the generated link. The Worker only ever
fetches `https://app.qgenda.com/ical?key=<uuid>`, stores nothing, and has logging disabled.
Don't commit real feed files or keys to a public repo.
