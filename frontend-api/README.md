# Brepline API Portal

A black and orange developer portal for the Brepline LMM API. React 18 + Vite + React Router. No UI library, no Tailwind, about 24 KB of CSS.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Overview: stats, 3-step getting started, quickstart code, changelog, status |
| `/keys` | Create, copy and revoke keys. Test/live env, scoped permissions, secret shown once |
| `/playground` | Run a request (demo mode or live), see response, download link, generated code |
| `/docs` | Full reference: auth, errors, rate limits, every endpoint, webhooks, changelog |
| `/usage` | Requests per day chart (7/14/30d), success rate, recent requests table |
| `/webhooks` | Endpoint URL, event selection, signing secret, test event |
| `/pricing` | Plans with monthly/yearly toggle and FAQ |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in /dist
```

Deploys to Vercel as-is (`vercel.json` already rewrites all routes to `index.html`).

## Connect it to your real backend

1. Copy `.env.example` to `.env` and set `VITE_API_BASE_URL`.
2. **Keys** (`src/pages/ApiKeys.jsx`): `create()` currently makes a random key in the browser. Replace it with a call to your backend that creates and stores a *hashed* key, then returns the secret once. Only key metadata is saved to localStorage here, never the secret.
3. **Playground** (`src/lib/api.js`): live mode already calls `POST {BASE_URL}/generate`. Your API must allow CORS from this site, or proxy the call through your server.
4. **Usage, pricing and plan numbers** are placeholders. Edit `src/lib/config.js` (`PLAN`), `src/pages/Usage.jsx` (replace `series()` and `LOG` with `GET /usage`) and `src/pages/Pricing.jsx`.
5. **Endpoints and docs** live in `src/lib/docs.js`. Edit them to match your real API.
6. **Auth**: this portal assumes the user is already signed in. Add your login guard around `<Layout />` in `src/App.jsx`.

## Theme and look

- **Dark (default) and light (off-white with Aqua pinstripes)** themes. The toggle is in the top bar and the choice is remembered. Default is set in `index.html` and `src/lib/theme.js`.
- **Glossy XP/Aqua skin** (pill buttons, title-bar windows, inset inputs, glossy nav pills) lives in one file, `src/styles/skin.css`. Delete its import in `src/main.jsx` to get the flat look back.
- Base colors and sizes are CSS variables: dark ones at the top of `src/styles/styles.css` (`--orange`, `--fs` for font size), light ones and gloss gradients at the top of `skin.css`.

## Structure

```
src/
  components/   Layout, Code (highlighting + tabs), Modal, Toast, Icon, PageHeader
  pages/        Overview, ApiKeys, Playground, Docs, Usage, Webhooks, Pricing
  lib/          config, api client, snippets, docs data, highlighter, storage
  styles/       styles.css (base), skin.css (glossy skin + light theme)
```
