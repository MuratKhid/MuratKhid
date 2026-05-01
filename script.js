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
  const items = document.querySelectorAll('.research__item, .project, .resume__card, .carousel__slide');
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

/* Carousel — arrow buttons + scroll progress bar */
(function() {
  const track = document.getElementById('carouselTrack');
  const prog = document.getElementById('carouselProgress');
  const prev = document.querySelector('.carousel__btn--prev');
  const next = document.querySelector('.carousel__btn--next');
  if (!track) return;

  // Scroll roughly one viewport-width worth on each click
  const scrollAmount = () => Math.max(track.clientWidth * 0.7, 320);

  prev?.addEventListener('click', () => {
    track.scrollBy({ left: -scrollAmount(), behavior: 'smooth' });
  });
  next?.addEventListener('click', () => {
    track.scrollBy({ left:  scrollAmount(), behavior: 'smooth' });
  });

  // Update progress bar as user scrolls horizontally
  const updateProgress = () => {
    if (!prog) return;
    const max = track.scrollWidth - track.clientWidth;
    const pct = max > 0 ? (track.scrollLeft / max) * 100 : 0;
    prog.style.width = pct + '%';
  };

  track.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
  // Re-measure once images load (their widths affect scrollWidth)
  track.querySelectorAll('img').forEach(img => {
    if (!img.complete) img.addEventListener('load', updateProgress);
  });
  updateProgress();
})();