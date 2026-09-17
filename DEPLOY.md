# Deploying the backend so nobody has to run it locally

This deploys the backend once, to a free, publicly reachable URL, so
every install of the extension talks to the same shared server instead
of each person running `npm start` on their own machine.

We use **Render** (render.com) — genuinely free, no credit card required,
as of when this was written. Two honest tradeoffs to know about upfront:

- **Cold starts**: a free service sleeps after 15 minutes with no
  requests, and the next request takes ~30-60 seconds to wake it up.
  Fine for a small team/personal tool, not instant every time.
- **Cache resets**: the backend currently caches completed analyses in a
  local JSON file (`lowdb`). Render wipes local files on every
  sleep/wake cycle, so that cache periodically empties — nothing breaks,
  a video just gets re-analyzed the first time it's checked after a
  reset instead of being served instantly. If this becomes a real
  problem later, swap `store/analysisStore.js` for a real database
  (Render's free Postgres is one option, though it expires after 30 days
  unless upgraded).

## Steps

### 1. Put the backend in its own Git repository

```bash
cd backend
git init
git add .
git commit -m "VERI backend"
```

Create a new repository on GitHub (github.com/new), then:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

(`.env` is already excluded via `.gitignore` — never commit your real API keys.)

### 2. Deploy on Render

1. Go to https://render.com, sign up (no card needed)
2. **New +** → **Web Service**
3. Connect your GitHub account and select the repo you just pushed
4. Configure:
   - **Name**: anything, e.g. `veri-backend`
   - **Root Directory**: leave blank if the repo *is* the backend folder (i.e. you ran `git init` inside `backend/` itself, as above)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. Under **Environment Variables**, add each one from your local `.env` file (Render's dashboard, not a committed file):
   - `GEMINI_API_KEY`
   - `TAVILY_API_KEY`
   - `ANALYSIS_MODEL` = `gemini-flash-latest`
   - `CLIENT_ORIGINS` = `chrome-extension://*`
   - (the rest are optional — defaults in `config.js` are sensible)
6. Click **Create Web Service**. First deploy takes a few minutes.
7. Once live, Render shows your URL, e.g. `https://veri-backend-xxxx.onrender.com`
8. Verify: open `https://veri-backend-xxxx.onrender.com/api/health` in a browser — should show `{"ok":true,...}` (give it 30-60s if it was just created, cold start applies here too)

### 3. Point the extension at it

Update two files in `extension/`:

- `background.js` — change `DEFAULT_BACKEND_URL` to your real Render URL
- `options.js` — change `DEFAULT_URL` to match

Then reload the extension (`chrome://extensions` → ↻). Every fresh
install now defaults to your deployed backend — nobody needs to touch
Settings or run anything locally.

### 4. (Optional but recommended before sharing widely) Lock down CORS

Right now `CLIENT_ORIGINS=chrome-extension://*` accepts requests from
*any* Chrome extension, not just yours. Once you've published the
extension and know its permanent ID (visible in `chrome://extensions`
once loaded, or assigned by the Chrome Web Store on publish), set
`CLIENT_ORIGINS` in Render's environment variables to
`chrome-extension://<your-actual-extension-id>` instead.
