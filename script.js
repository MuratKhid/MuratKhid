/* Theme toggle — paper ↔ blueprint, persisted in localStorage */
(function() {
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');

  // migrate old saved values ('dark'/'light') to new theme names
  const saved = (function() {
    const s = localStorage.getItem('theme');
    if (s === 'dark') return 'blueprint';
    if (s === 'light') return 'paper';
    return s;
  })();
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'blueprint' : 'paper'));

  if (toggle) {
    toggle.addEventListener('click', () => {
      const next = root.dataset.theme === 'blueprint' ? 'paper' : 'blueprint';
      applyTheme(next);
      localStorage.setItem('theme', next);
    });
  }

  function applyTheme(t) {
    root.dataset.theme = t;
    // button shows the theme you'd switch TO
    if (toggle) toggle.textContent = t === 'blueprint' ? 'paper' : 'blueprint';
    window.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  }
})();

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

/* Top scroll progress bar */
(function() {
  const fill = document.getElementById('scrollProgress');
  if (!fill) return;
  let ticking = false;
  function update() {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const p = total > 0 ? Math.min(1, window.scrollY / total) : 0;
    fill.style.width = (p * 100) + '%';
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
})();

/* ── Hero: potential flow around a cylinder — the cylinder is the cursor ───
   Classical inviscid solution: uniform stream + doublet. Particles are
   advected through the velocity field and leave ink trails on the sheet.  */
(function() {
  const canvas = document.getElementById('flowCanvas');
  if (!canvas) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  const ctx = canvas.getContext('2d');
  const hero = canvas.parentElement;

  let W = 0, H = 0, DPR = 1;
  let particles = [];
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
  let bgColor = '#eef0f2';

  function readTheme() {
    const s = getComputedStyle(document.documentElement);
    inkRGB    = s.getPropertyValue('--line-rgb').trim()   || inkRGB;
    accentRGB = s.getPropertyValue('--accent-rgb').trim() || accentRGB;
    bgColor   = s.getPropertyValue('--bg').trim()         || bgColor;
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
    ctx.clearRect(0, 0, W, H);
  }

  function seed() {
    const n = Math.max(220, Math.min(650, Math.round((W * H) / 3200)));
    particles = [];
    for (let i = 0; i < n; i++) particles.push(spawn(true));
  }

  function spawn(anywhere) {
    return {
      x: anywhere ? Math.random() * W : -10 - Math.random() * 40,
      y: Math.random() * H,
      px: 0, py: 0,
      life: 120 + Math.random() * 260
    };
  }

  /* velocity of uniform flow (left→right) past a cylinder at (cx, cy) */
  const U = 42; // free-stream speed, px/s-ish
  function vel(x, y) {
    const dx = x - cx, dy = y - cy;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1) return [0, 0];
    const R2 = R * R;
    const f = R2 / (r2 * r2);
    return [
      U * (1 - f * (dx * dx - dy * dy)),
      U * (-f * 2 * dx * dy)
    ];
  }

  let last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!visible || document.hidden) { requestAnimationFrame(frame); return; }

    // drift the cylinder gently when the pointer hasn't arrived (touch devices)
    if (!hasPointer) {
      driftT += dt * 0.35;
      tx = W * (0.5 + 0.22 * Math.sin(driftT));
      ty = H * (0.45 + 0.16 * Math.sin(driftT * 1.7 + 1.3));
    }
    cx += (tx - cx) * 0.07;
    cy += (ty - cy) * 0.07;

    // fade previous frame → ink trails
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    // advect + draw particles
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${inkRGB}, 0.34)`;
    ctx.beginPath();
    for (const p of particles) {
      p.px = p.x; p.py = p.y;
      const [u, v] = vel(p.x, p.y);
      p.x += u * dt * 2.2;
      p.y += v * dt * 2.2;
      p.life -= 1;

      const ddx = p.x - cx, ddy = p.y - cy;
      const inside = (ddx * ddx + ddy * ddy) < R * R * 1.02;

      if (p.x > W + 20 || p.y < -20 || p.y > H + 20 || p.life <= 0 || inside) {
        Object.assign(p, spawn(false));
        continue;
      }
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

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

  // pause when hero is offscreen
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.02 }).observe(hero);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('themechange', () => {
    readTheme();
    ctx.clearRect(0, 0, W, H);
  });

  readTheme();
  resize();
  requestAnimationFrame(t => { last = t; frame(t); });
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
