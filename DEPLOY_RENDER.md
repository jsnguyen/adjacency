# Deploying Adjacency on Render

Adjacency is a single Node web service in production. The server serves the built Vite files from `dist/` and accepts WebSocket connections at `/ws`.

## Render Settings

- Service type: Web Service
- Root Directory: `adjacency`
- Runtime: Node
- Build Command: `npm ci && npm run build`
- Start Command: `npm run start`

Render provides `PORT` automatically. The server binds to `0.0.0.0` and uses `process.env.PORT`, so no custom port setting is required.

## Optional Environment Variables

- `HOST`: defaults to `0.0.0.0`
- `ADJACENCY_DICTIONARY`: path to a newline/comma/space separated word list
- `ADJACENCY_WORDS`: inline word list, useful for tests
- `VITE_ADJACENCY_WS_URL`: explicit client WebSocket URL. Leave unset on Render so the client uses `wss://<your-host>/ws`.

## Local Production Check

```bash
npm ci
npm run build
npm test
npm run start
```

Then open `http://127.0.0.1:8080/`.
