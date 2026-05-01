# Murat Khidoyatov — Portfolio Site

Modern, technical, dark-mode portfolio with a terminal-inspired hero, JetBrains Mono for body text, and Fraunces serif for display headings. Pure HTML + CSS + JS, no build step, no framework.

## File structure

```
portfolio/
├── index.html          # main page — all content lives here
├── styles.css          # all styling
├── script.js           # theme toggle + scroll reveals
├── resume/             # put your two PDF resumes here
│   ├── Murat_Khidoyatov_Mechanical_Engineering_Resume.pdf
│   └── Murat_Khidoyatov_Computational_Aeroscience_Resume.pdf
└── img/                # photos for the gallery
    ├── rover-deployment.jpg
    ├── actuator-test.jpg
    └── ...
```

## Quick start

1. Drop your two résumé PDFs into a folder called `resume/`.
2. Drop gallery photos into `img/` and update the `<span>` filenames in `index.html` (search for `gallery__placeholder`).
3. Open `index.html` in a browser to preview.

## Customizing the gallery images

The placeholders show filenames like `img/rover-deployment.jpg`. Replace each `gallery__placeholder` block with a real image:

```html
<!-- before -->
<div class="gallery__item">
  <div class="gallery__placeholder">
    <span>img/rover-deployment.jpg</span>
    <small>Rover chassis assembly · 2025</small>
  </div>
</div>

<!-- after -->
<div class="gallery__item">
  <img src="img/rover-deployment.jpg" alt="Rover chassis assembly" />
</div>
```

Then add this CSS rule to `styles.css`:
```css
.gallery__item img { width: 100%; height: 100%; object-fit: cover; display: block; }
```

## Deploying to a custom domain

### Option 1 — GitHub Pages + custom domain

1. Create a public repo, push these files to `main`.
2. In repo Settings → Pages, set the source to `main` / root.
3. Add a `CNAME` file in the repo root containing your domain (e.g., `muratkhidoyatov.com`).
4. In your domain registrar's DNS, add an `A` record pointing to GitHub's IPs (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) or a `CNAME` record for `www` → `<your-username>.github.io`.

### Option 2 — Netlify / Vercel (easier)

1. Drag the entire `portfolio` folder onto netlify.com (or push to GitHub and connect via Vercel).
2. Add your custom domain in the dashboard. They handle SSL automatically.

### Option 3 — Traditional host

Just upload the files via FTP / cPanel to your `public_html` directory. No build step needed.

## Customization tips

**Change the accent color** — the electric chartreuse `#c8ff5e` is defined as `--accent` in `styles.css`. Swap it for any color (a deep cyan `#5ee2ff`, a coral `#ff6b5e`, etc.).

**Change the fonts** — fonts come from Google Fonts in `index.html`'s `<link>` tag. Swap `JetBrains+Mono` for `IBM+Plex+Mono`, `Space+Mono`, or `Fira+Code`. Swap `Fraunces` for `EB+Garamond`, `Cormorant+Garamond`, or `Playfair+Display`.

**Add a project** — copy any `<article class="project">` block and edit the contents.

**Edit the terminal text** — the `~/whoami` section in the hero. Change the `cmd` and `line--out` text in the `terminal__body` div.

## Notes

- The site works without JavaScript (theme toggle just won't work).
- Light mode is included — click the ◐ icon top-right.
- Fully responsive down to mobile.
- Uses `prefers-reduced-motion` for accessibility.
