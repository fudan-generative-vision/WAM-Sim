(() => {
  'use strict';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const status = document.querySelector('#media-status');
  const videos = [...document.querySelectorAll('video')];
  const report = message => { status.textContent = message; };
  const clock = seconds => {
    const value = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };

  // Every instance comparison remains a single playback unit with a shared clock.
  const pendingLoads = new WeakMap();
  const ready = video => {
    if (video.readyState >= 2) return Promise.resolve();
    if (pendingLoads.has(video)) return pendingLoads.get(video);
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Video loading timed out')), 30000);
      const loaded = () => finish();
      const failed = () => finish(new Error('Video could not load'));
      function finish(error) {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', loaded);
        video.removeEventListener('error', failed);
        error ? reject(error) : resolve();
      }
      video.addEventListener('loadeddata', loaded, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.preload = 'auto';
      video.load();
    }).finally(() => pendingLoads.delete(video));
    pendingLoads.set(video, promise);
    return promise;
  };
  const pairs = [...document.querySelectorAll('.sync-group')].map(element => {
    const pair = [...element.querySelectorAll('video')];
    const [lead, follower] = pair;
    const button = element.querySelector('.sync-play');
    const seek = element.querySelector('.sync-seek');
    const time = element.querySelector('.sync-time');
    let requested = false, epoch = 0, frame, pendingSeek = null;
    const controller = { element, userPaused: false, start, stop };
    const duration = () => Math.min(...pair.map(video => video.duration || Infinity));
    const update = () => {
      const total = duration();
      if (Number.isFinite(total)) {
        seek.value = String(Math.round(lead.currentTime / total * 1000));
        time.value = `${clock(lead.currentTime)} / ${clock(total)}`;
      }
    };
    function stop() {
      requested = false;
      epoch++;
      cancelAnimationFrame(frame);
      pair.forEach(video => video.pause());
      button.disabled = false;
      button.textContent = 'Play comparison';
      update();
    }
    const tick = () => {
      if (!requested) return;
      if (Math.abs(lead.currentTime - follower.currentTime) > 0.12 && !follower.seeking) follower.currentTime = lead.currentTime;
      update();
      frame = requestAnimationFrame(tick);
    };
    async function start() {
      if (requested) return;
      requested = true;
      const token = ++epoch;
      button.disabled = true;
      button.textContent = 'Loading…';
      try {
        await Promise.all(pair.map(ready));
        if (token !== epoch || !requested || document.hidden) return;
        const total = duration();
        const position = pendingSeek !== null ? pendingSeek * total : lead.currentTime >= total - 0.05 ? 0 : lead.currentTime;
        pendingSeek = null;
        pair.forEach(video => { video.currentTime = position; });
        await Promise.all(pair.map(video => video.play()));
        if (token !== epoch || !requested || document.hidden) {
          if (!requested) pair.forEach(video => video.pause());
          return;
        }
        button.textContent = 'Pause comparison';
        tick();
      } catch {
        if (token === epoch) {
          stop();
          report('Select Play comparison to start both videos.');
        }
      } finally {
        if (token === epoch) button.disabled = false;
      }
    }
    const toggle = () => {
      controller.userPaused = requested;
      requested ? stop() : start();
    };
    element.querySelector('.sync-controls').hidden = false;
    pair.forEach(video => {
      video.controls = false;
      video.addEventListener('loadedmetadata', update);
      video.addEventListener('click', toggle);
    });
    lead.addEventListener('ended', () => {
      if (!requested) return;
      stop();
      pair.forEach(video => { video.currentTime = 0; });
      start();
    });
    button.addEventListener('click', toggle);
    element.querySelector('.sync-restart').addEventListener('click', () => {
      controller.userPaused = false;
      stop(); pendingSeek = 0; start();
    });
    seek.addEventListener('input', () => {
      const fraction = Number(seek.value) / 1000;
      const total = duration();
      if (Number.isFinite(total)) {
        pair.forEach(video => { video.currentTime = Math.min(fraction * total, Math.max(0, total - 0.05)); });
        update();
      } else pendingSeek = fraction;
    });
    return controller;
  });

  // Each visible gallery starts all of its examples together, not just one tile.
  const userPaused = new WeakSet();
  const units = [...document.querySelectorAll('[data-playback-group]')].map(element => ({
    element, active: false,
    videos: [...element.querySelectorAll('video:not(.sync-video)')],
    pairs: pairs.filter(pair => element.contains(pair.element)),
  }));
  const resume = unit => {
    if (!unit.active || document.hidden || motion.matches) return;
    unit.videos.forEach(video => {
      if (userPaused.has(video)) return;
      video.muted = true;
      video.play().then(() => {
        if (!unit.active || document.hidden || motion.matches) video.pause();
      }).catch(() => {}); // Native controls remain available if autoplay is blocked.
    });
    unit.pairs.forEach(pair => { if (!pair.userPaused) pair.start(); });
  };
  const suspend = unit => {
    unit.videos.forEach(video => video.pause());
    unit.pairs.forEach(pair => pair.stop());
  };
  units.forEach(unit => {
    unit.videos.forEach(video => {
      video.addEventListener('pause', () => {
        if (unit.active && !document.hidden && !motion.matches && !video.ended && !video.dataset.adapting) userPaused.add(video);
      });
      video.addEventListener('play', () => userPaused.delete(video));
    });
  });

  // Re-stack the original scene triptychs for narrow screens.
  const portrait = matchMedia('(max-width: 600px)');
  document.querySelectorAll('video[data-mobile-src]').forEach(video => {
    const desktop = { src: video.getAttribute('src'), poster: video.getAttribute('poster') };
    const adapt = () => {
      const position = video.currentTime;
      const wasPlaying = !video.paused;
      video.dataset.adapting = 'true';
      video.pause();
      video.src = portrait.matches ? video.dataset.mobileSrc : desktop.src;
      video.poster = portrait.matches ? video.dataset.mobilePoster : desktop.poster;
      video.width = portrait.matches ? 640 : 3840;
      video.height = portrait.matches ? 1056 : 704;
      video.parentElement.classList.toggle('portrait', portrait.matches);
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(position, video.duration || position);
        delete video.dataset.adapting;
      }, { once: true });
      if (wasPlaying) video.play().catch(() => {});
    };
    if (portrait.matches) adapt();
    portrait.addEventListener('change', adapt);
  });

  const mediaBase = document.documentElement.dataset.mediaBase || '';
  const heroSection = document.querySelector('.hero');
  const hero = document.querySelector('#hero-video');
  const heroToggle = document.querySelector('.hero-toggle');
  let heroVisible = false, heroUserPaused = false;
  const revealHero = () => { heroSection.classList.add('hero-ready'); clearTimeout(introFallback); };
  // Count actual footage playback. A fallback keeps the paper accessible on slow networks.
  const loopStart = Number(hero.dataset.loopStart) || 0;
  // Slow networks: if the wall has not started playing after 8 s, show the title anyway.
  const introFallback = setTimeout(() => { if (hero.currentTime < 0.5) revealHero(); }, 8000);
  // The wall settles on the center 3x3 at loopStart; the title appears there, as in the overview video.
  hero.addEventListener('timeupdate', () => { if (hero.currentTime >= loopStart - 0.1) revealHero(); });
  hero.addEventListener('ended', () => {
    hero.currentTime = loopStart;
    if (heroVisible && !heroUserPaused && !motion.matches && !document.hidden && !filmOpen()) hero.play().catch(() => {});
  });
  hero.addEventListener('error', revealHero);
  // The title waits for the wall to settle. Only skip the intro for reduced motion, or when the page
  // opens scrolled past the hero (a deep link or a restored scroll position).
  // A refresh starts at the top so the wall intro plays; links with a section anchor still jump there.
  if ('scrollRestoration' in history && !location.hash) history.scrollRestoration = 'manual';
  const heroOutOfView = () => window.scrollY > heroSection.offsetHeight * 0.6;
  if (motion.matches || heroOutOfView()) revealHero();
  window.addEventListener('load', () => { if (heroOutOfView()) revealHero(); }, { once: true });
  const playRefused = error => { if (error && error.name === 'NotAllowedError') revealHero(); };
  const heroViewport = matchMedia('(max-width: 760px)');
  const adaptHero = () => {
    const stem = heroViewport.matches ? 'hero-mobile' : 'hero';
    // Media is served from the CDN named on <html data-media-base>; the page itself is on GitHub.
    const source = `${mediaBase}assets/${stem}.mp4`;
    if (hero.getAttribute('src') === source) return;
    hero.autoplay = !heroUserPaused && !motion.matches;
    hero.src = source;
    hero.poster = `${mediaBase}assets/${stem}.jpg`;
    hero.width = heroViewport.matches ? 960 : 1920;
    hero.height = heroViewport.matches ? 540 : 1080;
  };
  adaptHero();
  heroViewport.addEventListener('change', adaptHero);
  const updateHero = () => {
    const text = hero.paused ? 'Play preview' : 'Pause preview';
    heroToggle.textContent = text;
    heroToggle.setAttribute('aria-label', text);
  };
  const resumeHero = () => {
    if (heroVisible && !motion.matches && !heroUserPaused && !document.hidden && !filmOpen()) hero.play().catch(playRefused);
  };
  hero.addEventListener('play', updateHero);
  hero.addEventListener('pause', updateHero);
  heroToggle.addEventListener('click', () => {
    heroUserPaused = !hero.paused;
    if (hero.paused) hero.play().catch(() => { revealHero(); report('The preview could not play.'); });
    else { hero.pause(); revealHero(); }
  });
  if (motion.matches) { hero.autoplay = false; hero.pause(); }
  updateHero();

  // In-video scene labels step aside while the native controls are showing (paused or hovered).
  document.querySelectorAll('.labeled video').forEach(video => {
    const box = video.parentElement;
    const sync = () => box.classList.toggle('is-paused', video.paused);
    ['play', 'pause', 'ended'].forEach(type => video.addEventListener(type, sync));
    sync();
  });

  // Author list under the affiliations, collapsed by default.
  const authorsToggle = document.querySelector('.authors-toggle');
  if (authorsToggle) {
    const list = document.querySelector('#author-list');
    authorsToggle.addEventListener('click', () => {
      const open = list.hidden;
      list.hidden = !open;
      authorsToggle.setAttribute('aria-expanded', String(open));
      authorsToggle.querySelector('span').textContent = open ? '−' : '+';
    });
  }

  // Full overview video in a dialog, always played from the beginning.
  const film = document.querySelector('#film-dialog');
  const filmVideo = document.querySelector('#film-video');
  const filmButton = document.querySelector('.film-button');
  function filmOpen() { return Boolean(film && film.open); }
  if (film && filmButton) {
    filmButton.addEventListener('click', () => {
      hero.pause();
      if (typeof film.showModal === 'function') film.showModal(); else film.setAttribute('open', '');
      filmVideo.currentTime = 0;
      filmVideo.play().catch(() => report('Select play to start the video.'));
    });
    film.querySelector('.film-close').addEventListener('click', () => film.close());
    film.addEventListener('click', event => { if (event.target === film) film.close(); });
    film.addEventListener('close', () => { filmVideo.pause(); filmButton.focus(); resumeHero(); });
  }

  // Highlight rings and captions that follow the video clock (coordinates in 1280-wide source pixels).
  const COLORS = { note: '#579cda', keep: '#5b8f3a', lost: '#d9733a' };
  const ring = (color, keys, start, draw, end, opacity, halves) => ({ color, keys, start, draw, end, opacity, halves });
  const IM1_A = [[11.5, [470, 379, 48, 30]], [12.5, [440, 384, 55, 34]], [13.5, [397, 387, 68, 40]], [14.5, [317, 396, 95, 56]],
    [15.5, [160, 416, 165, 80]], [16.2, [60, 420, 130, 80]]];
  const IM1_B = [[26.2, [40, 518, 110, 90]], [26.6, [175, 466, 195, 115]], [27, [298, 430, 150, 82]], [27.5, [415, 405, 85, 55]],
    [28, [476, 397, 58, 42]], [28.6, [522, 394, 48, 34]], [29.2, [572, 380, 38, 28]], [29.8, [635, 378, 34, 25]]];
  const IM2_A = [[0, [1100, 455, 190, 132]]];
  const ANNOTATIONS = {
    instance_memory_1_without: [ring('note', IM1_A, 11.4, 0.5, 16.3, 0.85), ring('lost', IM1_B, 26.1, 0.4, 29.9, 0.85)],
    instance_memory_1_ours: [ring('note', IM1_A, 11.4, 0.5, 16.3, 0.85), ring('keep', IM1_B, 26.1, 0.4, 29.9, 0.85)],
    instance_memory_2_without: [ring('note', IM2_A, 0.3, 0.6, 4.1, 0.85), ring('lost', IM2_A, 12.2, 0.6, Infinity, 0.85)],
    instance_memory_2_ours: [ring('note', IM2_A, 0.3, 0.6, 4.1, 0.85), ring('keep', IM2_A, 12.2, 0.6, Infinity, 0.85)],
  };
  const CAPTIONS = {
    'instance-one': [
      { start: 11.6, end: 16.6, shared: 'A white SUV passes on the left and leaves the view' },
      { start: 26.3, end: Infinity, left: 'It returns as a red car', right: 'It returns as the same white SUV' },
    ],
    'instance-two': [
      { start: 0.5, end: 4.3, shared: 'A black car on the right, about to leave the view' },
      { start: 12.4, end: Infinity, left: 'It reappears as a white car', right: 'It reappears as the same black car' },
    ],
  };
  const SVG = 'http://www.w3.org/2000/svg';
  const clamp01 = value => Math.max(0, Math.min(1, value));
  const easeOut = value => 1 - (1 - clamp01(value)) ** 3;
  const sample = (keys, t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        const q = (t - t0) / (t1 - t0);
        return v0.map((value, k) => value + (v1[k] - value) * q);
      }
    }
    return keys[keys.length - 1][1];
  };
  const annotated = [...document.querySelectorAll('.annotated')].map(element => {
    const video = element.querySelector('video');
    const layer = element.querySelector('.annot-layer');
    const rings = (ANNOTATIONS[element.dataset.annot] || []).map(spec => {
      const shapes = (spec.halves ? [0, 704] : [0]).map(offset => {
        const shape = document.createElementNS(SVG, 'path');
        shape.setAttribute('pathLength', '1');
        shape.setAttribute('fill', 'none');
        shape.setAttribute('stroke', COLORS[spec.color]);
        shape.setAttribute('vector-effect', 'non-scaling-stroke');
        shape.classList.add('annot-ring');
        layer.append(shape);
        return { shape, offset };
      });
      return { spec, shapes };
    });
    return { video, rings };
  });
  const drawAnnotations = item => {
    const t = item.video.currentTime || 0;
    item.rings.forEach(({ spec, shapes }) => {
      const p = easeOut((t - spec.start) / spec.draw);
      const fade = Number.isFinite(spec.end) ? 1 - clamp01((t - spec.end) / 0.45) : 1;
      const [cx, cy, rx, ry] = sample(spec.keys, t);
      shapes.forEach(({ shape, offset }) => {
        if (p <= 0 || fade <= 0) { shape.style.opacity = '0'; return; }
        const top = cy + offset - ry, bottom = cy + offset + ry;
        // Two half-arcs starting at the top, so the ring draws in clockwise from 12 o'clock.
        shape.setAttribute('d', `M${cx} ${top}A${rx} ${ry} 0 1 1 ${cx} ${bottom}A${rx} ${ry} 0 1 1 ${cx} ${top}`);
        shape.setAttribute('stroke-dasharray', `${p} 1.01`);
        shape.style.opacity = String(spec.opacity * fade);
      });
    });
  };
  const captionBoxes = [...document.querySelectorAll('.annot-caption')].map(box => ({
    box,
    lead: box.closest('.example-panel').querySelector('video'),
    entries: CAPTIONS[box.dataset.caption] || [],
    parts: { shared: box.querySelector('.cap-shared'), left: box.querySelector('.cap-left'), right: box.querySelector('.cap-right') },
    current: null,
  }));
  const drawCaption = item => {
    const t = item.lead.currentTime || 0;
    const entry = item.entries.find(e => t >= e.start && t < e.end) || null;
    if (entry === item.current) return;
    item.current = entry;
    item.parts.shared.textContent = entry?.shared || '';
    item.parts.left.textContent = entry?.left || '';
    item.parts.right.textContent = entry?.right || '';
    item.box.classList.toggle('split', Boolean(entry && !entry.shared));
    item.box.classList.toggle('showing', Boolean(entry));
  };
  let annotFrame = 0;
  const annotTick = () => {
    annotated.forEach(item => { if (!item.video.paused) drawAnnotations(item); });
    captionBoxes.forEach(drawCaption);
    annotFrame = annotated.some(item => !item.video.paused) ? requestAnimationFrame(annotTick) : 0;
  };
  annotated.forEach(item => {
    const refresh = () => { drawAnnotations(item); captionBoxes.forEach(drawCaption); };
    ['loadedmetadata', 'seeked', 'timeupdate', 'pause'].forEach(type => item.video.addEventListener(type, refresh));
    item.video.addEventListener('play', () => { if (!annotFrame) annotFrame = requestAnimationFrame(annotTick); });
    drawAnnotations(item);
  });

  // Long-horizon player: two enlarged rollouts, four below. Selecting a lower clip swaps it with
  // the enlarged clip that has been up longest; tiles glide to their new places (FLIP).
  const lhPlayer = document.querySelector('.lh-player');
  if (lhPlayer) {
    const items = [...lhPlayer.querySelectorAll('.lh-item')];
    const shownAt = new Map(items.map((item, i) => [item, i]));   // initial order: first enlarged is oldest
    let clock = items.length;
    const mainItems = () => items.filter(item => item.dataset.slot.startsWith('m'));
    const oldestMain = () => mainItems().sort((a, b) => shownAt.get(a) - shownAt.get(b))[0];
    const syncControls = () => {
      items.forEach(item => { item.querySelector('video').controls = item.dataset.slot.startsWith('m'); });
      items.forEach(item => item.classList.toggle('lh-next', item === oldestMain()));
    };
    const swap = picked => {
      const out = oldestMain();
      const before = new Map(items.map(item => [item, item.getBoundingClientRect()]));
      [picked.dataset.slot, out.dataset.slot] = [out.dataset.slot, picked.dataset.slot];
      shownAt.set(picked, clock++);
      syncControls();
      if (motion.matches || document.hidden) return;
      items.forEach(item => {
        const a = before.get(item), b = item.getBoundingClientRect();
        if (!a.width || !b.width) return;
        const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return;
        item.animate([{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
                      { transformOrigin: 'top left', transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)' });
      });
      const video = picked.querySelector('video');
      if (video.paused && !userPaused.has(video)) video.play().catch(() => {});
    };
    items.forEach(item => {
      item.querySelector('.lh-pick').addEventListener('click', () => { if (item.dataset.slot.startsWith('s')) swap(item); });
      item.querySelector('.lh-pick').addEventListener('mouseenter', () => lhPlayer.classList.add('picking'));
      item.querySelector('.lh-pick').addEventListener('mouseleave', () => lhPlayer.classList.remove('picking'));
      item.querySelector('.lh-pick').addEventListener('focus', () => lhPlayer.classList.add('picking'));
      item.querySelector('.lh-pick').addEventListener('blur', () => lhPlayer.classList.remove('picking'));
    });
    syncControls();
  }

  if ('IntersectionObserver' in window) {
    const unitMap = new Map(units.map(unit => [unit.element, unit]));
    const playbackObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const unit = unitMap.get(entry.target);
        const active = entry.isIntersecting && entry.intersectionRatio >= unit.minRatio;
        if (unit.active === active) return;
        unit.active = active;
        if (active) { unit.element.classList.add('is-visible'); resume(unit); }
        else suspend(unit);
      });
    }, { threshold: [0, 0.06, 0.15, 0.25, 0.4] });
    // Start buffering a gallery shortly before it scrolls into view, so its first frames are ready
    // when playback starts instead of competing with the gallery above it.
    const warmObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        unitMap.get(entry.target).videos.forEach(video => {
          if (video.preload === 'none') { video.preload = 'auto'; video.load(); }
        });
        warmObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px 900px 0px' });
    units.forEach(unit => {
      unit.minRatio = Number(unit.element.dataset.activeRatio) || 0.06;
      if (!motion.matches) unit.element.classList.add('scroll-reveal');
      playbackObserver.observe(unit.element);
      warmObserver.observe(unit.element);
    });
    const heroObserver = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting && entry.intersectionRatio >= 0.08;
      heroVisible ? resumeHero() : hero.pause();
    }, { threshold: [0, 0.08] });
    heroObserver.observe(hero);
    const links = [...document.querySelectorAll('nav a')];
    const sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        links.forEach(link => {
          if (link.hash === `#${target.id}`) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-15% 0px -65% 0px' });
    document.querySelectorAll('main section[id]').forEach(section => sectionObserver.observe(section));
  } else {
    revealHero(); // No observer: keep native manual playback and all content visible.
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { units.forEach(suspend); hero.pause(); if (filmOpen()) filmVideo.pause(); }
    else { units.forEach(resume); resumeHero(); }
  });
  motion.addEventListener('change', event => {
    if (event.matches) {
      revealHero(); hero.pause(); units.forEach(suspend);
      document.querySelectorAll('.scroll-reveal').forEach(element => element.classList.add('is-visible'));
    } else { units.forEach(resume); resumeHero(); }
  });
  videos.forEach(video => {
    video.addEventListener('error', () => {
      const parent = video.parentElement;
      if (parent.querySelector('.media-error')) return;
      const message = document.createElement('p');
      message.className = 'media-error';
      message.append('This video could not be loaded. ');
      const link = document.createElement('a');
      link.textContent = 'Open the original video';
      link.href = video.currentSrc || video.src;
      link.className = 'text-link';
      message.append(link); parent.append(message);
    });
    video.addEventListener('loadeddata', () => video.parentElement.querySelector('.media-error')?.remove());
  });
})();
