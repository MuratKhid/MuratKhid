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

/* Subtle reveal-on-scroll for sections */
(function() {
  if (!('IntersectionObserver' in window)) return;
  const items = document.querySelectorAll('.research__item, .project, .resume__card');
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