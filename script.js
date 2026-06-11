/* Theme toggle with localStorage persistence */
(function() {
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  const ICON = { dark: '◐', light: '◑' };

  // initialize from saved preference or system
  const saved = localStorage.getItem('theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const initial = saved || (prefersLight ? 'light' : 'dark');
  applyTheme(initial);

  toggle.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('theme', next);
  });

  function applyTheme(t) {
    root.dataset.theme = t;
    toggle.querySelector('.theme-icon').textContent = ICON[t] || ICON.dark;
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

/* Hero terminal: type commands line by line */
(function() {
  const body = document.querySelector('.terminal__body');
  if (!body) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  const lines = Array.from(body.querySelectorAll('.line'));
  const steps = [];
  lines.forEach(line => {
    const cmd = line.querySelector('.cmd');
    if (cmd) {
      steps.push({ line, type: 'cmd', el: cmd, text: cmd.textContent });
      cmd.textContent = '';
    } else if (line.classList.contains('line--out')) {
      steps.push({ line, type: 'out' });
    } else {
      steps.push({ line, type: 'show' });
    }
    line.style.visibility = 'hidden';
  });

  let i = 0;
  function next() {
    if (i >= steps.length) return;
    const s = steps[i++];
    s.line.style.visibility = 'visible';
    if (s.type === 'cmd') {
      let c = 0;
      (function typeChar() {
        if (c < s.text.length) {
          s.el.textContent += s.text[c++];
          setTimeout(typeChar, 28 + Math.random() * 40);
        } else {
          setTimeout(next, 180);
        }
      })();
    } else {
      setTimeout(next, s.type === 'out' ? 220 : 120);
    }
  }
  setTimeout(next, 400);
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

/* Cursor-following spotlight on project cards */
(function() {
  if (window.matchMedia('(hover: none)').matches) return;
  document.querySelectorAll('.project').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
})();

/* Subtle reveal-on-scroll for sections */
(function() {
  if (!('IntersectionObserver' in window)) return;
  const items = document.querySelectorAll('.research__item, .project, .resume__card, .stat');
  items.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach(el => obs.observe(el));
})();

/* Apple-style horizontal-scroll-on-vertical-scroll gallery
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
    // read the current translateX from inline style, if any
    const t = track.style.transform || '';
    const m = t.match(/translate3d\(\s*(-?\d+(?:\.\d+)?)/);
    return m ? -parseFloat(m[1]) : 0;
  }

  function measure() {
    // we want the LAST slide's right edge to align with the viewport's right
    // edge when scroll progress = 1. Measure from the actual rendered DOM.
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

  // re-measure when each image actually loads (their widths affect the track)
  track.querySelectorAll('img').forEach(img => {
    if (img.complete) return;
    img.addEventListener('load',  refresh);
    img.addEventListener('error', refresh);
  });

  // safety re-measures for late-arriving fonts / layout settling
  setTimeout(refresh, 300);
  setTimeout(refresh, 1000);

  refresh();
})();