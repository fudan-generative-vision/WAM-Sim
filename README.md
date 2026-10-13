# WAM-Sim project page

This `gh-pages` branch holds the static project page for **WAM-Sim: World Anchored Memory Meets Online RL for Consistent and Realistic Driving Simulation**. GitHub Pages serves it as-is; there is no build step.

## Contents

- `index.html`: the page.
- `assets/style.css`, `assets/paper-theme.css`: layout and theme.
- `assets/site.js`: video-wall intro, synchronized comparisons, highlight rings and captions, overview-video dialog, autoplay on scroll.
- `assets/fonts/`: self-hosted DM Sans and Manrope (SIL Open Font License, licence files included).
- `.nojekyll`: serve files without Jekyll processing.

## Media

All videos and images are served from the CDN at `https://cdn.aondata.work/WAM-Sim/` (OSS bucket `oss://fusion-lab/WAM-Sim/`), with the same relative paths the page uses (`assets/...`, `video_materials/...`). The base URL is written into every media URL in `index.html` and on `<html data-media-base>`, which `site.js` uses for the opening video wall. When a video changes, upload the new file to the same OSS path and refresh the CDN cache.

## Deployment

In the repository settings, under Pages, set the source to "Deploy from a branch", branch `gh-pages`, folder `/ (root)`.

## Local preview

Serve this folder with any static server, for example `python3 -m http.server 8000`, and open `http://localhost:8000`.
