# Portfolio

Personal portfolio for [@ilcde](https://github.com/ilcde). The project list is **not** written by
hand: the page asks the GitHub REST API for the repositories at load time, ranks them, and renders
the cards. Push a new repository and it shows up here on its own.

**Live:** <https://ilcde.github.io/Portfolio/>

## How the live data works

| Endpoint | Used for |
| --- | --- |
| `GET /users/ilcde` | avatar, display name, followers, public repo count, join date, location |
| `GET /users/ilcde/repos?per_page=100&sort=pushed` | every public repository behind the cards |

Both calls are unauthenticated, so no token or secret ever ships to the browser.

What the page derives from that response:

- **Featured row** — the three highest scoring repositories. Score rewards stars, forks, having a
  description, topics, repository size and recent pushes; it penalises archived repositories and
  forks. Nothing is pinned by hand.
- **Language filter pills** — built from the languages actually present, with counts.
- **Top language** stat — most repositories, ties broken by total code size.
- **Live demo links** — shown when a repository has a `homepage` set, or GitHub Pages enabled.
- **Stars, followers, repo count** — read from the profile and summed from the repository list.
- The profile repository (`ilcde/ilcde`, the GitHub README) is filtered out, since it is not a project.

## Configuration

One value, at the top of `app.js`:

```js
const USERNAME = "ilcde";
```

Everything else follows from it, including the Pages URLs used for demo links.

## Rate limits and caching

GitHub allows **60 unauthenticated requests per hour per IP**. To stay well inside that budget the
response is cached in `localStorage` for **30 minutes**. On a failure the page falls back to the
cached copy and shows a “showing cached data” notice instead of an empty grid; with no cache at all
it shows a clear error and a direct link to the repository list.

## Deployment

The repository is ready for GitHub Pages in either mode.

**Deploy from a branch** (simplest)

1. Settings → Pages → Source: *Deploy from a branch*
2. Branch: `Main`, folder: `/ (root)`
3. Save. The site appears at `https://ilcde.github.io/Portfolio/`.

**GitHub Actions** (uses the bundled workflow)

1. Settings → Pages → Source: *GitHub Actions*
2. Push to `Main`; `.github/workflows/deploy-pages.yml` uploads the folder and deploys it.

Note the branch here is `Main` with a capital M — that is how this repository was created, and the
workflow trigger matches it. If the branch is ever renamed to `main`, update the workflow too.

`.nojekyll` is included so GitHub serves the files as-is instead of running Jekyll over them.

## Local preview

Opening `index.html` from the filesystem works, but a local server is closer to production:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Files

```
index.html   markup and copy; every dynamic slot is an id or [data-stat] hook
style.css    design tokens in :root, then components; responsive at 880px and 640px
app.js       fetch, cache, rank, filter, render; the only config is USERNAME
404.html     styled not-found page (self-contained styles, works at any depth)
.nojekyll    serve files as-is on GitHub Pages
```

## Notes

- No build step, no dependencies, no framework. Three files and a workflow.
- Accessibility: skip link, visible focus rings, `aria-pressed` filter pills, a `role="status"`
  result line, alt text on every meaningful image, and `prefers-reduced-motion` support.
- All rendering goes through `textContent` and DOM nodes rather than `innerHTML`, so descriptions
  and topics coming from the API cannot inject markup.
- The Discord and Facebook links in the contact section are placeholders; search `TODO` in
  `index.html` to fill them in.
