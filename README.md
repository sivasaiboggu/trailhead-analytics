# Trailhead

Follow a visit from the first page view to the last click. Trailhead pairs a small embeddable tracker with a session timeline and a document-relative click map. The included walking-journal demo generates real traffic for both views.

## Run locally

Install Node.js 22 or later, npm, and Docker with Compose. From the repository root:

```sh
docker compose up -d mongo
npm install
npm test
npm start
```

Open http://localhost:3000. Choose **Open demo**, expand a route note, then return to the dashboard and choose **Refresh**. Select your session to inspect the timestamp, page and coordinates. Switch to **Click map** to see where the clicks landed. Reload the demo to add a second page view to the same session.

For an existing MongoDB instance, skip Compose and set `MONGODB_URI` to a connection string including the database name. The default is `mongodb://127.0.0.1:27017/trailhead`. The server reads `PORT` (default 3000).

## Embed

```html
<script defer src="http://localhost:3000/tracker.js"></script>
```

For HTTPS pages serve the tracker and API from an HTTPS origin. The script sends events to the origin serving the script. The React dashboard and Node.js/Express API share one server. React is served from installed dependencies. MongoDB holds the event history.

## API

| Method and path | Result |
| --- | --- |
| POST /api/events | Validate and store one event. Returns 201 on success and 400 for invalid input. |
| GET /api/sessions | Session IDs, counts and last activity, newest first. |
| GET /api/sessions/:id | Events in ascending timestamp order. |
| GET /api/pages | Distinct tracked page URLs. |
| GET /api/clicks?url=… | Raw click positions and source document dimensions. URL-encode the page URL. |

## Design decisions

- A session expires after 30 minutes without a tracked event. Tabs on the same origin share local storage. When storage is blocked, the session lasts for the current document.
- Page identity uses the origin and path. Query strings and fragments are discarded at collection and ingestion. The tracker never reads form values.
- Clicks use document coordinates, including the scrolled portion. Each position is divided by the document width and height captured at click time. The map shows relative density across layouts. It cannot identify a particular element after a responsive reflow.
- Collection is best effort. Offline visits can be lost. Page views correspond to document loads. Client-side routing would need a navigation hook.
- This local, single-site review build exposes anonymous ingestion and dashboard reads. Before hosting real traffic, add authenticated dashboard access, ingestion quotas, retention and pagination. Compound indexes support session journeys and per-page click queries.

## Technical references

- [MDN — MouseEvent.pageX](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/pageX) explains the document coordinate system used by the tracker.
- [MongoDB — Indexes](https://www.mongodb.com/docs/manual/indexes/) describes how indexes support filtered queries.

