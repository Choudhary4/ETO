/**
 * ETO Doors - Dynamic Homepage Apps v4 (Extreme Performance)
 * Pure Image Enhancer & Parallel Fetcher
 * 
 * The application list is now pre-rendered server-side by Liquid for zero layout shift.
 * This script only fetches representative product images for each card in parallel.
 */

(function () {
    'use strict';

    // Cache config
    const CACHE_KEY = 'eto_app_images_v2';
    const CACHE_DURATION = 1000 * 60 * 60 * 4; // 4 hours

    function getCachedImages() {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (!cached) return {};
            const data = JSON.parse(cached);
            if (Date.now() - data.timestamp > CACHE_DURATION) return {};
            return data.images || {};
        } catch (e) {
            return {};
        }
    }

    function cacheImage(url, imgSrc) {
        try {
            const cache = getCachedImages();
            cache[url] = imgSrc;
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                images: cache
            }));
        } catch (e) {
            console.warn('ETO Home: Cache error', e);
        }
    }

    async function fetchImageForCard(imgEl) {
        const fetchUrl = imgEl.getAttribute('data-src-fetch');
        if (!fetchUrl) return;

        // check cache first
        const cache = getCachedImages();
        if (cache[fetchUrl]) {
            imgEl.src = cache[fetchUrl];
            revealImage(imgEl);
            return;
        }

        try {
            // Fetch the collection page HTML
            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error('Fetch failed');
            const html = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Find first product image
            let imgSrc = '';
            const foundImg = doc.querySelector('.card__media img, .product-card img, #product-grid .grid__item img, .grid-view-item__image');

            if (foundImg) {
                imgSrc = foundImg.src || foundImg.getAttribute('data-src') || (foundImg.srcset ? foundImg.srcset.split(' ')[0] : '');
                if (imgSrc && imgSrc.startsWith('//')) imgSrc = 'https:' + imgSrc;
                if (imgSrc) imgSrc = imgSrc.split('?')[0] + '?width=600';
            }

            if (imgSrc) {
                imgEl.src = imgSrc;
                revealImage(imgEl);
                cacheImage(fetchUrl, imgSrc);
            } else {
                revealPlaceholder(imgEl);
            }

        } catch (e) {
            console.warn('ETO Home: Error fetching', fetchUrl, e);
            revealPlaceholder(imgEl);
        }
    }

    function revealImage(imgEl) {
        const wrapper = imgEl.parentElement;
        const placeholder = wrapper.querySelector('.eto-app-image-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        imgEl.style.display = 'block';
        imgEl.classList.add('loaded');
    }

    function revealPlaceholder(imgEl) {
        const wrapper = imgEl.parentElement;
        const placeholder = wrapper.querySelector('.eto-app-image-placeholder');
        if (placeholder) placeholder.style.display = 'flex';
    }

    function initDynamicImages() {
        const grid = document.getElementById('dynamic-apps-grid');
        if (!grid) return;

        const images = grid.querySelectorAll('img[data-src-fetch]');
        if (images.length === 0) return;

        // Fetch ALL in parallel
        const promises = Array.from(images).map(img => fetchImageForCard(img));

        Promise.allSettled(promises).then(() => {
            console.log('ETO Home: Optimization complete.');
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDynamicImages);
    else initDynamicImages();

})();
