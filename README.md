# My Movie Site

React + Vite frontend, Express API, MongoDB Atlas metadata, and Cloudflare R2 storage.

## Project layout

```text
movie-app/
├── api/index.js          # Express API / Vercel Function
├── client/               # React + Vite frontend
├── dev-server.js         # Local API server
├── vercel.json           # Vercel routing/build configuration
├── package.json
└── .env.example
```

## How deployment works

A single Vercel project hosts both parts of the application:

- `/` → React/Vite application
- `/admin` → admin login and movie upload page
- `/movie/:id` → movie player page
- `/api/*` → Express API
- Browser → Cloudflare R2 directly for poster/MKV uploads using presigned URLs

The MKV file does **not** pass through Vercel. Vercel only creates the presigned R2 URL and stores movie metadata in MongoDB.

## Required Vercel environment variables

Add these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `ADMIN_PASSWORD` | Password used on `/admin` |
| `JWT_SECRET` | Long random secret used to sign admin tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_ACCESS_KEY_ID` | R2 access key |
| `CLOUDFLARE_SECRET_ACCESS_KEY` | R2 secret key |
| `CLOUDFLARE_BUCKET_NAME` | R2 bucket name |
| `CLOUDFLARE_R2_PUBLIC_URL` | Public R2 bucket URL/custom domain |

Never put these values in `client/` or variables beginning with `VITE_`. Vite exposes `VITE_*` values to browser code.

## R2 CORS

Direct browser uploads require R2 CORS. Add the exact origins from which the admin page will upload.

For local development:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "POST",
      "DELETE",
      "HEAD"
    ],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

After the Vercel deployment gets its domain, add that HTTPS origin as well. Do not add `*` for production unless you intentionally want any website to be allowed to perform browser uploads.

## Deploy to Vercel

1. Push this project to GitHub/GitLab/Bitbucket.
2. Import the repository into Vercel.
3. Keep the repository root as the Vercel project root.
4. Add all 8 environment variables listed above.
5. Deploy.
6. Open the generated Vercel URL.
7. Test `/` and `/admin`.
8. Update R2 CORS with the deployed HTTPS origin.
9. Log in at `/admin` and upload a poster plus `.mkv` movie.

The repository already contains the Vercel configuration, so you should not need to manually set a separate frontend root directory.

## Local development

1. Copy `.env.example` to `.env` and fill in your local/remote credentials.
2. Install dependencies:

```bash
npm install
npm --prefix client install
```

3. Start the API:

```bash
npm run dev:api
```

4. In another terminal start Vite:

```bash
npm run dev:client
```

5. Open `http://localhost:5173`.

The Vite development server proxies `/api/*` to the Express server on port `3001`.

## Important security notes

- Do not commit `.env`.
- Use MongoDB Atlas in production; `mongodb://127.0.0.1:27017/...` only works on the local machine.
- Use a strong `ADMIN_PASSWORD`.
- Use a long random `JWT_SECRET`.
- Rotate any R2 credentials that have previously been exposed outside the Cloudflare dashboard.
- Keep R2 access keys server-side only.

## MKV playback

Browser playback of `.mkv` depends on the codecs contained in the file and browser support. The download link is retained so the file can be opened in VLC when browser playback is unavailable.
