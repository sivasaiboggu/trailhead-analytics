# Trailhead

Built for the CausalFunnel Full Stack Engineer assignment.

Follow a visit from the first page view to the last click. Trailhead pairs a small embeddable tracker with a session timeline and a document-relative click map. The included walking-journal demo generates real traffic for both views.

## Run locally

Install Node.js 22 or later, npm, and Docker with Compose. From the repository root:

```sh
docker compose up -d mongo
npm install
npm test
npm start
```

Open http://localhost:3000. Choose **Open demo**, expand a route note, then return to the dashboard and choose **Refresh**. The dashboard also refreshes itself every 10 seconds while it is visible, once the current fetch has settled. Select your session to inspect the timestamp, page and coordinates. Switch to **Click map** to see where the clicks landed. Reload the demo to add a second page view to the same session. The demo has a second page, /trail.html, so one visit can span two pages.

The server binds 127.0.0.1 by default. Set `HOST` to listen elsewhere only behind authentication (see below).

Integration check: `node scripts/check-api.js` (needs MongoDB running). The check starts its own throwaway database (`trailhead_check_…`) and drops it afterwards, so it never touches your development data. Use a disposable database for the check — never point it at real data.

Browser smoke test: `node scripts/smoke.mjs` (needs MongoDB running and headless Chrome). It starts its own throwaway database and server on an OS-assigned port, loads the demo in headless Chrome, follows the demo → trail link, records a real pointer click, and verifies both page views share one session, the click appears in the journey and the heatmap, the double-inclusion guard holds, and the dashboard auto-refresh advances. It cleans up the database, server and browser afterwards.

For an existing MongoDB instance, skip Compose and set `MONGODB_URI` to a connection string including the database name. The default is `mongodb://127.0.0.1:27017/trailhead`. The server reads `PORT` (default 3000) and `ALLOWED_ORIGINS` (see below).

## Embed

```html
<script defer src="http://localhost:3000/tracker.js"></script>
```

For HTTPS pages serve the tracker and API from an HTTPS origin. The script sends events to the origin serving the script. The React dashboard and Node.js/Express API share one server. React is served from installed dependencies. MongoDB holds the event history.

## API

| Method and path | Result |
| --- | --- |
| POST /api/events | Validate and store one event. Returns 201 on success and 400 for invalid input. |
| GET /api/sessions | Session IDs, counts, first and last activity, and first page, newest first. Limited to the 100 most recently active sessions. |
| GET /api/sessions/:id | Events in ascending event-time order (ties broken by server receipt time, then insertion order). Limited to 1000 events. |
| GET /api/pages | Distinct tracked page URLs. |
| GET /api/clicks?url=… | Pointer-click positions and source document dimensions for one page (keyboard clicks excluded). URL-encode the page URL. Limited to 5000 clicks. |

A complete valid page view:

```json
{
  "session_id": "a3f1c9e2-4b5d-4c6a-8e7f-0123456789ab",
  "type": "page_view",
  "url": "https://example.com/demo",
  "timestamp": "2026-11-27T10:00:00.000Z"
}
```

A complete valid click:

```json
{
  "session_id": "a3f1c9e2-4b5d-4c6a-8e7f-0123456789ab",
  "type": "click",
  "url": "https://example.com/demo",
  "timestamp": "2026-11-27T10:00:05.000Z",
  "x": 120,
  "y": 240,
  "width": 1280,
  "height": 900,
  "pointer": true
}
```

Field rules: `session_id` is a string of 8–80 letters, digits and dashes. `type` is `page_view` or `click`. `url` must be a string with an `http:` or `https:` scheme; only the origin and path are stored. `timestamp` is an ISO 8601 string no earlier than 2020-01-01 and no more than one day in the future. For clicks, `x` and `y` are document coordinates in pixels, `width` and `height` are the document dimensions (each 1–100000 px, and `x`/`y` must lie inside them), and `pointer` is a boolean that is true only when a real pointer produced the click. A valid event returns `201` with an empty body. Anything breaking a rule returns `400` with `{"error": "Invalid event"}`; malformed JSON also returns `400`.

## Demo-only boundary

This build is for local review, not for shared hosting. Ingestion (`POST /api/events`) and the read APIs (`GET /api/sessions`, `/api/sessions/:id`, `/api/pages`, `/api/clicks`) are anonymous: anyone who can reach the server can submit events and read every session. The server binds 127.0.0.1 by default, which keeps it on the local machine. Before putting it on a shared host, add operator authentication on the read routes, an ingestion allow-list, quotas, retention and pagination.

Cross-origin embedding is closed by default: `POST /api/events` answers CORS only to the server's own origin. Set `ALLOWED_ORIGINS` to a comma-separated list of origins that may embed the tracker, for example `ALLOWED_ORIGINS=https://shop.example.com`. Origins outside the list get no CORS grant.

## Design decisions

- A session expires after 30 minutes without a tracked event. Tabs on the same origin share local storage. When storage is blocked, the session lasts for the current document. A stored session is only reused when it is well formed (a non-empty string id and a finite activity time); anything else is discarded and a fresh session is generated.
- Page identity uses the origin and path. Query strings and fragments are discarded at collection and ingestion. The tracker never reads form values.
- Clicks use document coordinates, including the scrolled portion. Each position is divided by the document width and height captured at click time. The map shows relative density across layouts. It cannot identify a particular element after a responsive reflow. Only clicks a real pointer produced appear on the map; keyboard-triggered clicks are recorded in the journey but excluded from the heatmap.
- Every event carries a server receipt time (`receivedAt`). Journeys order by event time, then receipt time, then insertion order, so two events with the same millisecond timestamp still come back in the order they arrived. Session activity spans use the receipt times.
- Collection is best effort. Offline visits can be lost. Page views correspond to document loads. Client-side routing would need a navigation hook. Including the tracker twice for the same endpoint records one page view, not two.
- This local, single-site review build exposes anonymous ingestion and dashboard reads — see "Demo-only boundary" above. Compound indexes support session journeys and per-page click queries. Responses are bounded: 100 sessions, 1000 journey events, 5000 clicks per page.

## Technical references

- [MDN — MouseEvent.pageX](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/pageX) explains the document coordinate system used by the tracker.
- [MongoDB — Indexes](https://www.mongodb.com/docs/manual/indexes/) describes how indexes support filtered queries.

