(function () {
  'use strict';

  var PHOTOS_URL = 'images/photos/photos.json';
  var CURATION_URL = 'images/photos/curation.json';

  var state = {
    selected: [],
    archive: [],
    gallery: [],
    lightboxIndex: 0,
    heroIndex: 0,
    heroTimer: null
  };

  var els = {
    heroSlides: document.getElementById('hero-slides'),
    selectedGrid: document.getElementById('selected-grid'),
    archiveGrid: document.getElementById('archive-grid'),
    archiveSection: document.getElementById('archive'),
    lightbox: document.getElementById('photo-lightbox'),
    lbImg: document.getElementById('photo-lightbox-img'),
    lbCaption: document.getElementById('photo-lightbox-caption'),
    lbClose: document.querySelector('.photo-lightbox__close'),
    lbPrev: document.querySelector('.photo-lightbox__nav--prev'),
    lbNext: document.querySelector('.photo-lightbox__nav--next')
  };

  /* ---- Fetch ---- */

  function safeFetch(url, fallback) {
    return fetch(url)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return fallback; });
  }

  /* ---- Normalize ---- */

  function filename(path) {
    return decodeURIComponent((path || '').split('/').pop());
  }

  function normalize(raw, curation) {
    var meta = curation.photos || {};
    var order = curation.featuredOrder || [];
    var orderSet = {};
    order.forEach(function (name, i) { orderSet[name] = i; });

    var enriched = raw.map(function (p) {
      var name = filename(p.full);
      var c = meta[name] || {};
      return {
        thumbnail: p.thumbnail,
        full: p.full,
        filename: name,
        title: c.title || '',
        description: c.description || '',
        location: c.location || '',
        year: c.year || '',
        featured: Boolean(c.featured) || name in orderSet,
        rank: name in orderSet ? orderSet[name] : 9999
      };
    });

    var selected = enriched
      .filter(function (p) { return p.featured; })
      .sort(function (a, b) { return a.rank - b.rank; });

    var selectedSet = {};
    selected.forEach(function (p) { selectedSet[p.full] = true; });

    var archive = enriched.filter(function (p) { return !selectedSet[p.full]; });

    return { selected: selected, archive: archive };
  }

  /* ---- Hero ---- */

  function renderHero() {
    if (!els.heroSlides) return;
    var source = state.selected.length ? state.selected : state.gallery.slice(0, 8);
    if (!source.length) return;

    els.heroSlides.innerHTML = '';

    source.forEach(function (photo, i) {
      var slide = document.createElement('div');
      slide.className = 'photo-hero__slide' + (i === 0 ? ' is-active' : '');
      var img = document.createElement('img');
      img.src = photo.full;
      img.alt = photo.title || 'Photography by Aaron Doucett';
      slide.appendChild(img);
      els.heroSlides.appendChild(slide);
    });

    state.heroIndex = 0;
    clearInterval(state.heroTimer);

    if (source.length < 2) return;

    state.heroTimer = setInterval(function () {
      var slides = els.heroSlides.querySelectorAll('.photo-hero__slide');
      slides[state.heroIndex].classList.remove('is-active');
      state.heroIndex = (state.heroIndex + 1) % slides.length;
      slides[state.heroIndex].classList.add('is-active');
    }, 7000);
  }

  /* ---- Gallery ---- */

  function photoButton(photo, index, staggerIndex) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'photo-item';
    btn.setAttribute('aria-label', photo.title ? 'View: ' + photo.title : 'View photograph');
    btn.style.setProperty('--reveal-delay', (staggerIndex % 4) * 80 + 'ms');

    var img = document.createElement('img');
    img.src = photo.thumbnail;
    img.alt = photo.title || 'Photograph';
    img.loading = 'lazy';
    img.decoding = 'async';
    btn.appendChild(img);

    btn.addEventListener('click', function () { openLightbox(index); });
    return btn;
  }

  function renderGallery() {
    state.gallery = [];
    var stagger = 0;

    if (els.selectedGrid && state.selected.length) {
      els.selectedGrid.innerHTML = '';
      state.selected.forEach(function (photo) {
        var idx = state.gallery.length;
        state.gallery.push(photo);
        els.selectedGrid.appendChild(photoButton(photo, idx, stagger++));
      });
    }

    if (els.archiveGrid && state.archive.length) {
      els.archiveGrid.innerHTML = '';
      stagger = 0;
      state.archive.forEach(function (photo) {
        var idx = state.gallery.length;
        state.gallery.push(photo);
        els.archiveGrid.appendChild(photoButton(photo, idx, stagger++));
      });
    }

    if (els.archiveSection && !state.archive.length) {
      els.archiveSection.style.display = 'none';
    }

    observeItems();
  }

  /* ---- Scroll reveal ---- */

  function observeItems() {
    var items = document.querySelectorAll('.photo-item');
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px 80px 0px' });

    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---- Lightbox ---- */

  function captionFor(photo) {
    var parts = [photo.title, photo.location, photo.year].filter(Boolean);
    return parts.join(' \u2014 ');
  }

  function updateLightbox() {
    var photo = state.gallery[state.lightboxIndex];
    if (!photo || !els.lbImg) return;

    els.lbImg.style.opacity = '0';
    var preload = new Image();
    preload.onload = function () {
      els.lbImg.src = photo.full;
      els.lbImg.alt = photo.title || 'Photograph';
      requestAnimationFrame(function () {
        els.lbImg.style.opacity = '1';
      });
    };
    preload.src = photo.full;

    if (els.lbCaption) els.lbCaption.textContent = captionFor(photo);

    [-1, 1].forEach(function (offset) {
      var n = state.gallery[(state.lightboxIndex + offset + state.gallery.length) % state.gallery.length];
      if (n) { var p = new Image(); p.src = n.full; }
    });
  }

  function openLightbox(index) {
    if (!els.lightbox || !state.gallery.length) return;
    state.lightboxIndex = index;
    els.lightbox.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    updateLightbox();
  }

  function closeLightbox() {
    if (!els.lightbox) return;
    els.lightbox.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function navLightbox(dir) {
    if (!state.gallery.length) return;
    state.lightboxIndex = (state.lightboxIndex + dir + state.gallery.length) % state.gallery.length;
    updateLightbox();
  }

  /* ---- Events ---- */

  function wireEvents() {
    if (els.lbClose) els.lbClose.addEventListener('click', closeLightbox);
    if (els.lbPrev) els.lbPrev.addEventListener('click', function () { navLightbox(-1); });
    if (els.lbNext) els.lbNext.addEventListener('click', function () { navLightbox(1); });

    if (els.lightbox) {
      els.lightbox.addEventListener('click', function (e) {
        if (e.target === els.lightbox || e.target === els.lightbox.querySelector('.photo-lightbox__body')) {
          closeLightbox();
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (!els.lightbox || !els.lightbox.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') navLightbox(-1);
      if (e.key === 'ArrowRight') navLightbox(1);
    });
  }

  /* ---- Init ---- */

  function init() {
    Promise.all([
      safeFetch(PHOTOS_URL, { photos: [] }),
      safeFetch(CURATION_URL, {})
    ]).then(function (results) {
      var photosData = results[0];
      var curation = results[1];
      var result = normalize(photosData.photos || [], curation);

      state.selected = result.selected;
      state.archive = result.archive;

      renderHero();
      renderGallery();
      wireEvents();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
