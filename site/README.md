# No Brand Baseball website

The public website, in the Film Room look. It lives outside `www/` so the phone builds (which bundle `www/`) do not carry it.

| Path | What |
|---|---|
| `site/pages/*.html` | One file per page: the content between the top bar and the footer. The first line is a comment with the page title and description. `home.html` becomes `index.html`. |
| `site/css/site.css` | Shared look: colours, type, top bar, menu, footer, buttons |
| `site/css/home.css`, `site/js/home.js` | Home page only: the film hero, tracking and scroll pieces |
| `site/css/inner.css`, `site/js/site.js` | Every other page |
| `site/media/` | Hero film, its still frame and the tracking data |
| `tools/site/build.mjs` | Wraps each page in the top bar and footer and writes `_site/` |
| `tools/site/serve.mjs` | Local preview at http://localhost:8790/ |

## Build and preview
```
node tools/site/build.mjs
node tools/site/serve.mjs
```
`_site/` is the upload-ready folder: the website at the root and the pitcher app (a copy of `www/`) at `/app/`. It is not committed.

The build fails if a link or file reference points at nothing, or if a page shows a vendor name. It also lists every placeholder still waiting on real content.

## Going live
`node tools/site/build.mjs --live` removes the "do not index" tag. Set `SITE_URL` (for example `https://www.nobrandbaseball.com`) to add share-preview tags.

Log in: Athlete and Coach go to the app at `/app/`. Team and Pitch Tip Tool show "ask us for an account" on `login.html` until that backend exists.
