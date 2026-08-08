/* Mobile menu toggle */
(function() {
  const burger = document.getElementById('navBurger');
  const menu = document.getElementById('mobileMenu');
  if (!burger || !menu) return;

  function setOpen(open) {
    burger.classList.toggle('is-open', open);
    menu.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
  }

  burger.addEventListener('click', () => setOpen(!menu.classList.contains('is-open')));
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
})();

/* Rail: vertical scroll progress along the rail's right edge */
(function() {
  const fill = document.getElementById('railProgress');
  if (!fill) return;
  let ticking = false;
  function update() {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const p = total > 0 ? Math.min(1, window.scrollY / total) : 0;
    fill.style.height = (p * 100) + '%';
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

/* Rail: highlight the section currently in view */
(function() {
  const links = document.querySelectorAll('.rail__link[href^="#"]');
  if (!links.length || !('IntersectionObserver' in window)) return;

  const byId = {};
  links.forEach(a => { byId[a.getAttribute('href').slice(1)] = a; });
  const sections = Object.keys(byId)
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (!sections.length) return;

  function setActive(id) {
    links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + id));
  }

  const obs = new IntersectionObserver(entries => {
    // pick the visible section nearest the top of the viewport
    const visible = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) setActive(visible[0].target.id);
  }, { rootMargin: '-20% 0px -55% 0px' });

  sections.forEach(s => obs.observe(s));
})();

/* ── Hero: flow past a cylinder — the cylinder is the cursor ──────────────
   Uniform stream + doublet (classical potential flow) plus a von Kármán
   street of vortices shed into the wake. Continuous streamlines — smoke
   streams in a wind tunnel — are traced through the combined field each
   frame and colored by local speed (blue = slow, red = fast), with faint
   drifting pulses of ink to show direction.                               */
(function() {
  const canvas = document.getElementById('flowCanvas');
  if (!canvas) return;
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const ctx = canvas.getContext('2d');
  const hero = canvas.parentElement;

  let W = 0, H = 0, DPR = 1;
  let streams = [];
  let running = true;
  let visible = true;

  // cylinder (cursor) state — eased toward pointer target
  let cx = 0, cy = 0;         // current
  let tx = 0, ty = 0;         // target
  let R = 60;                 // cylinder radius
  let hasPointer = false;
  let driftT = Math.random() * 100;

  // theme colors, refreshed on theme change
  let inkRGB = '22, 24, 29';
  let accentRGB = '29, 67, 204';

  function readTheme() {
    const s = getComputedStyle(document.documentElement);
    inkRGB    = s.getPropertyValue('--line-rgb').trim()   || inkRGB;
    accentRGB = s.getPropertyValue('--accent-rgb').trim() || accentRGB;
  }

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    R = Math.max(42, Math.min(W, H) * 0.085);
    if (!hasPointer) { cx = tx = W * 0.62; cy = ty = H * 0.42; }
    seed();
  }

  function seed() {
    // one smoke stream every ~30px of inlet height; phase and width are
    // derived from the index so a resize doesn't make the pulses jump
    const n = Math.max(12, Math.round(H / 30));
    streams = [];
    for (let i = 0; i < n; i++) {
      streams.push({
        f: (i + 0.5) / n,                              // inlet height, fraction of H
        phase: (i * 137.508) % 48,                     // de-syncs the pulses
        w: 0.8 + 0.4 * Math.abs(Math.sin(i * 2.399)),  // slight thickness variation
        pts: []                                        // last traced polyline
      });
    }
  }

  /* ── velocity field: uniform stream + doublet + shed vortices ─────────── */
  const U = 42;    // free-stream speed (field units)
  const VIS = 2.2; // field units → px/s on screen

  // Kármán street: vortices shed alternately from the shoulders, advected
  // by the flow, cores spreading (rc² grows linearly, as Lamb–Oseen) and
  // circulation decaying as they travel downstream
  const vortices = [];
  let shedT = 0, shedSide = 1;   // +1 = bottom shoulder, -1 = top
  const SHED_PERIOD = 1.5;

  function shed() {
    const rc = R * 0.5;
    vortices.push({
      x: cx + R * 0.65,
      y: cy + shedSide * R * (0.7 + Math.random() * 0.25),
      // top-shed vortices spin clockwise on screen, bottom counter-clockwise;
      // magnitude sets peak swirl ≈ 1.2·U at r = rc, jittered for irregularity
      gamma: -shedSide * 2.4 * U * rc * (0.85 + Math.random() * 0.3),
      rc2: rc * rc,
      age: 0,
      g: 0,               // effective (faded-in) strength, set each tick
      cut2: 12 * rc * rc  // influence radius ≈ 3.5·rc, keeps the far field steady
    });
    if (vortices.length > 14) vortices.shift();
  }

  // twin recirculation bubble behind the body, modeled as Föppl's classical
  // standing vortex pair: two counter-rotating eddies plus their opposite-
  // sign images at the inverse points R²/z̄, which keep the cylinder surface
  // a streamline (without images the eddy flow pierces the body). Entries
  // 0,1 = top/bottom eddies; 2,3 = their images. They follow the cylinder
  // and fade while it moves fast, when the shed street takes over visually.
  const standing = [
    { x: 0, y: 0, g: 0, rc: 1, rc2: 1, cut2: 1 },
    { x: 0, y: 0, g: 0, rc: 1, rc2: 1, cut2: 1 },
    { x: 0, y: 0, g: 0, rc: 1, rc2: 1, cut2: 1 },
    { x: 0, y: 0, g: 0, rc: 1, rc2: 1, cut2: 1 }
  ];
  let eddyFade = 1;
  function updateStanding(dt, cylSpeed) {
    eddyFade += ((cylSpeed > 25 ? 0.3 : 1) - eddyFade) * Math.min(1, dt * 2);
    const rc = R * 0.55, rc2 = rc * rc;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const vo = standing[i];
      const im = standing[i + 2];
      const exr = R * 1.6, eyr = side * R * 0.7;
      vo.x = cx + exr;
      vo.y = cy + eyr;
      vo.rc = rc;
      vo.rc2 = rc2;
      vo.cut2 = 12 * rc2;
      // top eddy circulates clockwise on screen, bottom counter-clockwise,
      // so bubble fluid near the centerline flows back toward the body
      vo.g = -side * 2.6 * U * rc * eddyFade;
      const d2 = exr * exr + eyr * eyr;
      im.x = cx + R * R * exr / d2;
      im.y = cy + R * R * eyr / d2;
      im.rc = rc * 0.5;
      im.rc2 = rc2 * 0.25;
      im.cut2 = 12 * rc2 * 0.25;
      im.g = -vo.g;
    }
  }

  const V = [0, 0]; // vel() output, reused to avoid per-call allocations
  function vel(x, y) {
    let u, v;
    if (fnoField) {
      // base flow bilinearly sampled from the Fourier Neural Operator's
      // predicted 64×64 field, using the normalization scale the field
      // was computed under (not the current one)
      const s = 64 * fnoScale;
      const fx = Math.max(0, Math.min(63.999, x * s));
      const fy = Math.max(0, Math.min(63.999, y * s));
      const j0 = fx | 0, i0 = fy | 0;
      const dj = j0 < 63 ? 1 : 0, di = i0 < 63 ? 64 : 0;
      const ax = fx - j0, ay = fy - i0;
      const g = fnoField, t = i0 * 64 + j0, o = 4096;
      u = U * ((g[t] * (1 - ax) + g[t + dj] * ax) * (1 - ay) +
               (g[t + di] * (1 - ax) + g[t + di + dj] * ax) * ay);
      v = U * ((g[o + t] * (1 - ax) + g[o + t + dj] * ax) * (1 - ay) +
               (g[o + t + di] * (1 - ax) + g[o + t + di + dj] * ax) * ay);
    } else {
      const dx = x - cx, dy = y - cy;
      const r2 = dx * dx + dy * dy;
      if (r2 < 1) { V[0] = 0; V[1] = 0; return; }
      const R2 = R * R;
      const f = R2 / (r2 * r2);
      u = U * (1 - f * (dx * dx - dy * dy));
      v = U * (-f * 2 * dx * dy);
    }
    // finite cores: v_theta = g·r / (r² + rc²), with a smooth far-field
    // cutoff so vortices only stir the wake — upstream and outer streams
    // stay wind-tunnel steady instead of swaying with every shed vortex
    for (let i = 0; i < vortices.length; i++) {
      const vo = vortices[i];
      const ax = x - vo.x, ay = y - vo.y;
      const d2 = ax * ax + ay * ay;
      const c = vo.g * vo.cut2 / ((vo.cut2 + d2) * (d2 + vo.rc2));
      u -= ay * c;
      v += ax * c;
    }
    for (let i = 0; i < standing.length; i++) {
      const vo = standing[i];
      const ax = x - vo.x, ay = y - vo.y;
      const d2 = ax * ax + ay * ay;
      const c = vo.g * vo.cut2 / ((vo.cut2 + d2) * (d2 + vo.rc2));
      u -= ay * c;
      v += ax * c;
    }
    V[0] = u; V[1] = v;
  }

  function moveVortices(dt, cylSpeed) {
    // vortices are shed only while the cylinder is actually moving — a
    // stationary model settles to the steady flow pattern instead of
    // churning forever, and its wake washes out within a few seconds
    const moving = cylSpeed > 12;
    if (moving) {
      shedT += dt;
      if (shedT > SHED_PERIOD) { shedT = 0; shedSide = -shedSide; shed(); }
    }
    for (let i = vortices.length - 1; i >= 0; i--) {
      const vo = vortices[i];
      vel(vo.x, vo.y);               // self-term vanishes at its own center
      let au = V[0], av = V[1];
      // the doublet is near-singular inside the cylinder — cap advection
      // speed so a vortex brushed by the cursor is never slingshotted
      const sp = Math.sqrt(au * au + av * av), cap = U * 2.5;
      if (sp > cap) { au *= cap / sp; av *= cap / sp; }
      vo.x += au * VIS * dt;
      vo.y += av * VIS * dt;
      vo.age += dt;
      vo.rc2 += 260 * dt;            // viscous core growth
      vo.gamma *= Math.exp(-dt / (moving ? 6 : 2.5)); // decay — faster at rest
      vo.g = vo.gamma * Math.min(1, vo.age / 0.6); // fade in — no field pops
      vo.cut2 = 12 * vo.rc2;
      const weak = Math.abs(vo.gamma) / (2 * Math.sqrt(vo.rc2)) < U * 0.06;
      if (vo.x > W + 120 || vo.x < -150 || vo.y < -150 || vo.y > H + 150 || weak) {
        vortices.splice(i, 1);
      }
    }
  }

  /* march a streamline from the left inlet across the sheet (RK2, unit
     speed, smaller steps near the cylinder so lines hug the surface) */
  const STALL = U * 0.008;
  function trace(x0, y0, pts, spd, cap) {
    let x = x0, y = y0;
    pts.length = 0;
    spd.length = 0;
    const sdx = x - cx, sdy = y - cy;
    if (sdx * sdx + sdy * sdy < R * R * 1.05) return; // seed blocked by model
    vel(x, y);
    pts.push(x, y);
    spd.push(Math.sqrt(V[0] * V[0] + V[1] * V[1]));
    let xMax = x, stall = 0;
    const maxSteps = cap || Math.ceil((W + 160) / 1.5);
    for (let i = 0; i < maxSteps; i++) {
      const ddx = x - cx, ddy = y - cy;
      const gap = Math.sqrt(ddx * ddx + ddy * ddy) - R;
      const h = Math.max(1.25, Math.min(4, 1.25 + gap * 0.22));

      vel(x, y);
      let u = V[0], v = V[1];
      let s = Math.sqrt(u * u + v * v);
      if (s < STALL) break;                       // stagnation — stream stalls
      vel(x + (u / s) * h * 0.5, y + (v / s) * h * 0.5);
      u = V[0]; v = V[1];
      s = Math.sqrt(u * u + v * v);
      if (s < STALL) break;
      x += (u / s) * h;
      y += (v / s) * h;

      // the body surface is itself a streamline: a point pushed inside
      // (numerical noise near stagnation) is projected back onto a thin
      // slip shell so the line wraps the cylinder instead of vanishing
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < R + 1.5) {
        const p = (R + 1.5) / Math.max(d, 1e-6);
        x = cx + dx * p;
        y = cy + dy * p;
      }
      pts.push(x, y);
      spd.push(s);
      if (x > xMax) { xMax = x; stall = 0; }
      // entrained by a vortex: keep wrapping long enough that the line
      // ends deep inside its own spiral, never as a visible loose end
      else if (++stall > 320) break;
      if (x > W + 24 || y < -80 || y > H + 80) break;
    }
  }

  /* solenoidal bubble field for orbit tracing: analytic base + standing
     eddies without the far-field cutoff. The neural field's ~2% noise makes
     integrated orbits spiral instead of closing, so the loops are traced
     through the exact divergence-free model instead — visually identical. */
  function velBubble(x, y) {
    const dx = x - cx, dy = y - cy;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1) { V[0] = 0; V[1] = 0; return; }
    const R2 = R * R;
    const f = R2 / (r2 * r2);
    let u = U * (1 - f * (dx * dx - dy * dy));
    let v = U * (-f * 2 * dx * dy);
    for (let i = 0; i < standing.length; i++) {
      const vo = standing[i];
      const ax = x - vo.x, ay = y - vo.y;
      const c = vo.g / (ax * ax + ay * ay + vo.rc2);
      u -= ay * c;
      v += ax * c;
    }
    V[0] = u; V[1] = v;
  }

  /* closed-orbit tracer for the standing eddies: a loop is drawn only if
     the trajectory genuinely returns to its seed — an open arc ending
     mid-fluid would read as a floating line, so those are discarded */
  function traceOrbit(x0, y0, pts, spd) {
    let x = x0, y = y0;
    pts.length = 0;
    spd.length = 0;
    const sdx = x - cx, sdy = y - cy;
    if (sdx * sdx + sdy * sdy < R * R * 1.05) return;
    velBubble(x, y);
    pts.push(x, y);
    spd.push(Math.sqrt(V[0] * V[0] + V[1] * V[1]));
    for (let i = 0; i < 260; i++) {
      const ddx = x - cx, ddy = y - cy;
      const gap = Math.sqrt(ddx * ddx + ddy * ddy) - R;
      const h = Math.max(1.25, Math.min(4, 1.25 + gap * 0.22));

      velBubble(x, y);
      let u = V[0], v = V[1];
      let s = Math.sqrt(u * u + v * v);
      if (s < STALL) break;
      velBubble(x + (u / s) * h * 0.5, y + (v / s) * h * 0.5);
      u = V[0]; v = V[1];
      s = Math.sqrt(u * u + v * v);
      if (s < STALL) break;
      x += (u / s) * h;
      y += (v / s) * h;

      const bdx = x - cx, bdy = y - cy;
      if (bdx * bdx + bdy * bdy < R * R * 1.01) break;
      pts.push(x, y);
      spd.push(s);
      const rx = x - x0, ry = y - y0;
      if (i > 16 && rx * rx + ry * ry < 64) { // back at the seed — seal it
        pts.push(x0, y0);
        spd.push(s);
        return;
      }
    }
    pts.length = 0; // never closed — draw nothing
    spd.length = 0;
  }

  /* CFD-style speed colormap over t = |v|/U: stagnation blue → free-stream
     teal → accelerated flanks and vortex cores in yellow/red */
  const CMAP = [
    [0.0, 41, 98, 218],
    [0.55, 36, 146, 205],
    [1.0, 26, 166, 122],
    [1.5, 196, 176, 44],
    [1.9, 232, 122, 32],
    [2.3, 226, 52, 44]
  ];
  const NBUCKET = 26, TMAX = 2.3;
  const bucketColor = [];
  const buckets = [];
  for (let k = 0; k < NBUCKET; k++) {
    const t = (k / (NBUCKET - 1)) * TMAX;
    let a = CMAP[0], b = CMAP[CMAP.length - 1];
    for (let j = 0; j < CMAP.length - 1; j++) {
      if (t >= CMAP[j][0] && t <= CMAP[j + 1][0]) { a = CMAP[j]; b = CMAP[j + 1]; break; }
    }
    const m = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    bucketColor.push('rgba(' +
      Math.round(a[1] + (b[1] - a[1]) * m) + ', ' +
      Math.round(a[2] + (b[2] - a[2]) * m) + ', ' +
      Math.round(a[3] + (b[3] - a[3]) * m) + ', 0.5)');
    buckets.push([]);
  }

  /* ── the base flow is predicted live by a Fourier Neural Operator — a
     PhysicalAI experiment. fno/train_fno.py trains it, fno.js executes it
     in a Web Worker; until the weights arrive (or if they can't) the
     analytic solution stands in seamlessly. ──────────────────────────── */
  let fnoField = null, fnoErr = 0;
  let fnoA = -1, fnoB = -1, fnoR = -1, fnoLastReq = 0, fnoLogged = false;
  let fnoScale = 1, fnoReqS = 1; // px→[0,1] scale: in-flight and field's own
  let figErrStr = '';
  const fig = document.querySelector('.hero__fig');

  function updateFig() {
    if (!fig || !fnoField) return;
    const e = (fnoErr * 100).toFixed(1);
    if (e === figErrStr) return; // avoid DOM churn at prediction rate
    figErrStr = e;
    fig.innerHTML = '<strong>Fig. 001</strong> — flow past a cylinder, predicted live by a ' +
      'neural network (within ' + e + '% of the exact solution)<br />' +
      '<strong>PhysicalAI</strong> · the cylinder is your cursor';
  }

  function maybeRequestFNO(now) {
    const F = window.FNOFlow;
    if (!F || !F.ready || F.pending) return;
    const s = 1 / Math.max(W, H);
    const a = cx * s, b = cy * s, r = R * s;
    if (fnoField && Math.abs(a - fnoA) + Math.abs(b - fnoB) + Math.abs(r - fnoR) < 0.0035) return;
    if (now - fnoLastReq < 90) return;
    fnoLastReq = now;
    fnoReqS = s;
    F.predict(a, b, r);
  }

  function onFNOField(res) {
    fnoField = res.field;
    fnoErr = res.err;
    fnoA = res.a; fnoB = res.b; fnoR = res.r;
    fnoScale = fnoReqS;
    if (!fnoLogged) {
      fnoLogged = true;
      console.log('[FNO · PhysicalAI] inference: ' + res.ms.toFixed(1) +
        ' ms in a worker · 56k params · 64×64 grid · rel. L2 vs analytic ' +
        (res.err * 100).toFixed(1) + '%');
    }
    updateFig();
  }

  function initFNO(attempt) {
    window.FNOFlow.init('fno/', err => {
      if (!err) return;
      if (attempt < 2) setTimeout(() => initFNO(attempt + 1), 8000);
      else console.warn('[FNO] operator weights unavailable — using the analytic flow', err);
    }, onFNOField);
  }

  function loadFNO() {
    if (window.FNOFlow) { initFNO(1); return; }
    const tag = document.createElement('script');
    tag.src = 'fno.js';
    tag.onload = () => initFNO(1);
    tag.onerror = () => console.warn('[FNO] fno.js failed to load — using the analytic flow');
    document.head.appendChild(tag);
  }

  console.log('%c⌁ PhysicalAI — the hero flow is predicted live by a 56k-param Fourier ' +
    'Neural Operator (see fno/train_fno.py) running in a Web Worker.',
    'font-family: monospace; color: #1d43cc;');

  const DASH = [14, 34];  // ink pulse length, gap — period must match phase mod
  const spdTmp = [];
  let dashT = 0;

  // closed streamlines nested inside the twin eddies — inlet streams can't
  // cross a recirculation bubble's separatrix, so the swirls need their
  // own loops (drawn only when they genuinely close)
  const EDDY_LINES = [];
  [-1, 1].forEach(side => [0.15, 0.3, 0.45, 0.6].forEach(k => {
    EDDY_LINES.push({
      side, k,
      phase: (EDDY_LINES.length * 137.508) % 48,
      w: 0.9,
      pts: []
    });
  }));

  // the stagnation streamline pair — seeded at the inlet just off the
  // cylinder's centerline height, it splits at the nose, hugs the body,
  // wraps the bubble as its separatrix and continues downstream after
  // reattachment: the line that connects the eddies to the rest of the flow
  const SURF_LINES = [
    { side: -1, phase: 11, w: 1.05, pts: [] },
    { side: 1, phase: 29, w: 1.05, pts: [] }
  ];

  function binSegments(pts, spd) {
    for (let i = 2; i < pts.length; i += 2) {
      let k = ((spd[i >> 1] / U) / TMAX * (NBUCKET - 1)) | 0;
      if (k >= NBUCKET) k = NBUCKET - 1;
      buckets[k].push(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
    }
  }

  function strokeDashed(pts, w, phase) {
    if (pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineWidth = w;
    ctx.lineDashOffset = -(dashT + phase);
    ctx.stroke();
  }

  let last = performance.now();
  let rafPending = false;
  function frame(now) {
    if (!running) { rafPending = false; return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!visible || document.hidden) { requestAnimationFrame(frame); return; }

    // drift the cylinder very gently when the pointer hasn't arrived (touch
    // devices) — a wind-tunnel model mostly holds still
    if (!hasPointer) {
      driftT += dt * 0.2;
      tx = W * (0.55 + 0.15 * Math.sin(driftT));
      ty = H * (0.45 + 0.10 * Math.sin(driftT * 1.7 + 1.3));
    }
    const pcx = cx, pcy = cy;
    cx += (tx - cx) * 0.07;
    cy += (ty - cy) * 0.07;
    const cylSpeed = dt > 0 ? Math.hypot(cx - pcx, cy - pcy) / dt : 0;

    moveVortices(dt, cylSpeed);
    updateStanding(dt, cylSpeed);
    maybeRequestFNO(now);
    dashT += dt * 60; // pulse drift speed, px/s

    ctx.clearRect(0, 0, W, H);

    // trace all streams, binning each segment by its local speed
    for (const b of buckets) b.length = 0;
    for (const st of streams) {
      trace(-24, st.f * H, st.pts, spdTmp);
      binSegments(st.pts, spdTmp);
    }
    for (const el of EDDY_LINES) {
      const vo = standing[el.side < 0 ? 0 : 1];
      traceOrbit(vo.x + el.k * R, vo.y, el.pts, spdTmp);
      binSegments(el.pts, spdTmp);
    }
    for (const sl of SURF_LINES) {
      trace(-24, cy + sl.side * R * 0.06, sl.pts, spdTmp);
      binSegments(sl.pts, spdTmp);
    }

    // colored filaments — one stroke per speed band
    ctx.setLineDash([]);
    ctx.lineWidth = 1.15;
    for (let k = 0; k < NBUCKET; k++) {
      const b = buckets[k];
      if (!b.length) continue;
      ctx.beginPath();
      for (let j = 0; j < b.length; j += 4) {
        ctx.moveTo(b[j], b[j + 1]);
        ctx.lineTo(b[j + 2], b[j + 3]);
      }
      ctx.strokeStyle = bucketColor[k];
      ctx.stroke();
    }

    // faint ink pulses drifting along each stream and around the eddies
    ctx.setLineDash(DASH);
    ctx.strokeStyle = `rgba(${inkRGB}, 0.18)`;
    for (const st of streams) strokeDashed(st.pts, st.w, st.phase);
    for (const el of EDDY_LINES) strokeDashed(el.pts, el.w, el.phase);
    for (const sl of SURF_LINES) strokeDashed(sl.pts, sl.w, sl.phase);
    ctx.setLineDash([]);

    // the cylinder — dashed circle + crosshair, drawn crisp each frame
    ctx.save();
    ctx.strokeStyle = `rgba(${accentRGB}, 0.85)`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const ch = 7;
    ctx.beginPath();
    ctx.moveTo(cx - ch, cy); ctx.lineTo(cx + ch, cy);
    ctx.moveTo(cx, cy - ch); ctx.lineTo(cx, cy + ch);
    ctx.stroke();
    // radius annotation
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = `rgba(${accentRGB}, 0.9)`;
    ctx.fillText('R = ' + Math.round(R) + ' mm', cx + R * 0.74, cy - R * 0.74);
    ctx.restore();

    requestAnimationFrame(frame);
  }

  // pointer tracking (mouse anywhere over the page maps into hero coords)
  window.addEventListener('mousemove', e => {
    const rect = hero.getBoundingClientRect();
    if (e.clientY >= rect.top - 200 && e.clientY <= rect.bottom + 200) {
      hasPointer = true;
      tx = e.clientX - rect.left;
      ty = e.clientY - rect.top;
    }
  }, { passive: true });

  hero.addEventListener('touchmove', e => {
    const rect = hero.getBoundingClientRect();
    const t = e.touches[0];
    if (!t) return;
    hasPointer = true;
    tx = t.clientX - rect.left;
    ty = t.clientY - rect.top;
    // release the "pointer" again after touch ends so drift resumes
    clearTimeout(hero._flowTO);
    hero._flowTO = setTimeout(() => { hasPointer = false; }, 2500);
  }, { passive: true });

  // pause when hero is offscreen (batched records arrive oldest-first —
  // only the newest reflects the current state)
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[entries.length - 1].isIntersecting;
    }, { threshold: 0.02 }).observe(hero);
  }

  window.addEventListener('resize', resize);

  // respect prefers-reduced-motion, including toggles mid-session
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    readTheme();
    resize();
    loadFNO();
    rafPending = true;
    requestAnimationFrame(t => { last = t; frame(t); });
  }
  if (reduceMQ.addEventListener) {
    reduceMQ.addEventListener('change', e => {
      running = !e.matches;
      if (!e.matches && !booted) { boot(); return; }
      if (!e.matches && !rafPending) {
        rafPending = true;
        last = performance.now();
        requestAnimationFrame(frame);
      }
    });
  }
  if (!reduceMQ.matches) boot();
})();

/* Animated stat counters */
(function() {
  const nums = document.querySelectorAll('.stat__num[data-count]');
  if (!nums.length || !('IntersectionObserver' in window)) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animate(el) {
    const target = parseInt(el.dataset.count, 10);
    if (reduce) { el.textContent = target; return; }
    const dur = 1400;
    const start = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  }

  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { animate(e.target); obs.unobserve(e.target); }
    });
  }, { threshold: 0.5 });
  nums.forEach(el => obs.observe(el));
})();

/* Reveal-on-scroll for section content */
(function() {
  if (!('IntersectionObserver' in window)) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  const items = document.querySelectorAll(
    '.research__item, .prow, .resume__card, .stat, .publication, .about__figure, .about__card, .tblock'
  );
  items.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(18px)';
    el.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
  });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  items.forEach(el => obs.observe(el));
})();

/* Horizontal-scroll-on-vertical-scroll gallery
   Maps vertical scroll progress through the .hscroll section onto a
   horizontal translation of the .hscroll__track */
(function() {
  const section = document.querySelector('.hscroll');
  const track = document.getElementById('hscrollTrack');
  const prog = document.getElementById('hscrollProgress');
  if (!section || !track) return;

  const mql = window.matchMedia('(max-width: 720px)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let maxX = 0;
  let ticking = false;

  function getCurrentX() {
    const t = track.style.transform || '';
    const m = t.match(/translate3d\(\s*(-?\d+(?:\.\d+)?)/);
    return m ? -parseFloat(m[1]) : 0;
  }

  function measure() {
    const lastSlide = track.lastElementChild;
    if (!lastSlide) { maxX = 0; return; }
    const trackRect = track.getBoundingClientRect();
    const lastRect = lastSlide.getBoundingClientRect();
    const currentX = getCurrentX();
    const contentEnd = (lastRect.right - trackRect.left) + currentX;
    const trailingPad = parseFloat(getComputedStyle(track).paddingRight || 0);
    maxX = contentEnd - window.innerWidth + trailingPad;
    if (maxX < 0) maxX = 0;
  }

  function update() {
    if (mql.matches || reduce.matches) {
      track.style.transform = '';
      if (prog) prog.style.width = '0%';
      return;
    }
    const rect = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    let p = total > 0 ? (-rect.top) / total : 0;
    p = Math.max(0, Math.min(1, p));
    track.style.transform = `translate3d(${-p * maxX}px, 0, 0)`;
    if (prog) prog.style.width = (p * 100) + '%';
  }

  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(() => { update(); ticking = false; });
      ticking = true;
    }
  }

  function refresh() { measure(); update(); }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', refresh);
  window.addEventListener('load', refresh);

  track.querySelectorAll('img').forEach(img => {
    if (img.complete) return;
    img.addEventListener('load',  refresh);
    img.addEventListener('error', refresh);
  });

  setTimeout(refresh, 300);
  setTimeout(refresh, 1000);

  refresh();
})();
