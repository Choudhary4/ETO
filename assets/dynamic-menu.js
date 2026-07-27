/**
 * ETO Doors - Dynamic Menu Handler (Fixed 2-Level Sidebar + Recursive Navbar)
 * Level 1 & 2: Static structure (curated category names).
 * Level 3: DYNAMIC — fetched from Shopify collection filters API.
 */

(function () {
    'use strict';

    const CACHE_KEY_PREFIX = 'eto_menu_cache_v1_';
    const CACHE_DURATION = 1000 * 60 * 5; // 5 Minutes (Faster updates)

    // Force Reset Cache if URL has ?reset_menu=1
    if (new URLSearchParams(window.location.search).has('reset_menu')) {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(CACHE_KEY_PREFIX)) localStorage.removeItem(key);
        });
        console.log('ETO Menu: Cache manually cleared via URL.');
    }

    /**
     * Static schema: defines the sidebar structure.
     * Items with `filterParam` will have their options loaded dynamically.
     * Items with `value` are direct links.
     */
    const STATIC_CATEGORIES = {
        "Interior Doors": {
            topFilter: "filter.p.m.custom.product_category=Interior",
            topLink: "/collections/all?filter.p.m.custom.product_category=Interior",
            items: [
                {
                    name: "Most Popular Interior Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Most Popular Interior Doors",
                    parentFilter: "filter.p.m.custom.product_category=Interior"
                },
                {
                    name: "Wood Interior Doors",
                    isGroup: true,
                    children: [
                        { name: "Mahogany Doors", filterValue: "Mahogany Doors" },
                        { name: "Solid Core Doors", filterValue: "Solid Core Doors" },
                        { name: "Knotty Alder Doors", filterValue: "Knotty Alder Doors" },
                        { name: "White Oak Doors", filterValue: "White Oak Doors" },
                        { name: "Walnut Doors", filterValue: "Walnut Doors" }
                    ]
                },
                {
                    name: "Modern Contemporary Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Modern Contemporary Doors",
                    parentFilter: "filter.p.m.custom.product_category=Interior"
                },
                {
                    name: "Fire Rated Interior Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Fire Rated Interior Doors",
                    parentFilter: "filter.p.m.custom.product_category=Interior"
                },
                {
                    name: "Closet Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Closet Doors",
                    parentFilter: "filter.p.m.custom.product_category=Interior"
                }
            ]
        },
        "Exterior Doors": {
            topFilter: "filter.p.m.custom.product_category=Exterior",
            topLink: "/collections/all?filter.p.m.custom.product_category=Exterior",
            items: [
                {
                    name: "Most Popular Exterior Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Most Popular Exterior Doors",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                },
                {
                    name: "Wood Doors",
                    isGroup: true,
                    children: [
                        { name: "Mahogany Front Doors", filterValue: "Mahogany Front Doors" },
                        { name: "Knotty Alder Front Doors", filterValue: "Knotty Alder Front Doors" },
                        { name: "White Oak Front Doors", filterValue: "White Oak Front Doors" },
                        { name: "Hand Carved Doors", filterValue: "Hand Carved Doors" },
                        { name: "Paint Grade Doors", filterValue: "Paint Grade Doors" }
                    ]
                },
                {
                    name: "Front Doors",
                    isGroup: true,
                    children: [
                        { name: "Primed Front Doors", filterValue: "Primed Front Doors" },
                        {
                            name: "Glass Front Doors",
                            isGroup: true,
                            children: [
                                { name: "Beveled Glass Front Doors", filterValue: "Beveled Glass Front Doors" },
                                { name: "Obscure Glass Doors", filterValue: "Obscure Glass Doors" }
                            ]
                        },
                        { name: "Fiberglass Front Doors", filterValue: "Fiberglass Front Doors" },
                        { name: "Modern Front Doors", filterValue: "Modern Front Doors" },
                        { name: "Rustic Front Doors", filterValue: "Rustic Front Doors" },
                        { name: "Mediterranean Front Doors", filterValue: "Mediterranean Front Doors" },
                        { name: "Craftsman Front Doors", filterValue: "Craftsman Front Doors" },
                        { name: "Contemporary Front Doors", filterValue: "Contemporary Front Doors" }
                    ]
                },
                {
                    name: "Fire Rated Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Fire Rated Exterior Doors",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                },
                {
                    name: "Patio Doors",
                    isGroup: true,
                    children: [
                        { name: "French Patio Doors", filterValue: "French Patio Doors" }
                    ]
                },
                {
                    name: "Fiberglass Doors",
                    isGroup: true,
                    children: [
                        { name: "Douglas Fir Fiberglass Doors", filterValue: "Douglas Fir Fiberglass Doors" },
                        { name: "Mahogany Fiberglass Doors", filterValue: "Mahogany Fiberglass Doors" },
                        { name: "Oak Woodgrain Fiberglass Doors", filterValue: "Oak Woodgrain Fiberglass Doors" },
                        { name: "Smooth Skin Fiberglass Doors", filterValue: "Smooth Skin Fiberglass Doors" },
                        { name: "White Oak Fiberglass Doors", filterValue: "White Oak Fiberglass Doors" },
                        { name: "Wrought Iron Fiberglass Doors", filterValue: "Wrought Iron Fiberglass Doors" },
                        { name: "Sidelite Door Sidelight", filterValue: "Sidelite Door Sidelight" }
                    ]
                },
                {
                    name: "Iron Grill Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Iron Grill Doors",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                },
                {
                    name: "Doors With Glass",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Doors with Glasses",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                },
                {
                    name: "Back Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Back Doors",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                },
                {
                    name: "Double Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Double Doors",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                },
                {
                    name: "Arched Doors",
                    isGroup: true,
                    children: [
                        { name: "Arched Double Doors", filterValue: "Arched Double Doors" }
                    ]
                },
                {
                    name: "Door Transoms",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Door Transoms",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                },
                {
                    name: "Sidelites",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Sidelites",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                },
                {
                    name: "Grand 9 ft. & 10 ft. Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Grand 9 ft and 10 ft Doors",
                    parentFilter: "filter.p.m.custom.product_category=Exterior"
                }
            ]
        },
        "French Doors": {
            topFilter: "filter.p.m.custom.product_category=French",
            topLink: "/collections/all?filter.p.m.custom.product_category=French",
            items: [
                {
                    name: "Most Popular",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Most Popular French Doors",
                    parentFilter: ""
                },
                {
                    name: "Exterior French Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Exterior French Doors",
                    parentFilter: "filter.p.m.custom.product_category=French"
                },
                {
                    name: "Interior French Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Interior French Doors",
                    parentFilter: "filter.p.m.custom.product_category=French"
                },
                {
                    name: "Fiberglass French Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Fiberglass French Doors",
                    parentFilter: "filter.p.m.custom.product_category=French"
                },
                {
                    name: "Bifold French Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Bifold French Doors",
                    parentFilter: "filter.p.m.custom.product_category=French"
                }
            ]
        },
        "Commercial": {
            topFilter: "filter.p.m.custom.product_category=Commercial",
            topLink: "/collections/all?filter.p.m.custom.product_category=Commercial",
            items: [
                {
                    name: "Interior Wood Flush Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Interior Wood Flush Doors",
                    parentFilter: "filter.p.m.custom.product_category=Commercial"
                },
                {
                    name: "Exterior Commercial Flush Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Exterior Commercial Flush Doors",
                    parentFilter: "filter.p.m.custom.product_category=Commercial"
                },
                {
                    name: "Commercial Door Hardware",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Commercial Door Hardware",
                    parentFilter: "filter.p.m.custom.product_category=Commercial"
                }
            ]
        },
        "Fire Rated": {
            topFilter: "filter.p.m.custom.product_category=Fire Rated",
            topLink: "/collections/all?filter.p.m.custom.product_category=Fire Rated", items: []
        },
        "Impact": {
            topFilter: "filter.p.m.custom.product_category=Impact",
            topLink: "/collections/all?filter.p.m.custom.product_category=Impact",
            items: [
                {
                    name: "Glass Impact Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Glass Impact Doors",
                    parentFilter: "filter.p.m.custom.product_category=Impact"
                },
                {
                    name: "French Impact Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "French Impact Doors",
                    parentFilter: "filter.p.m.custom.product_category=Impact"
                },
                {
                    name: "Front Impact Doors",
                    filterParam: "filter.p.m.custom.product_category",
                    filterValue: "Front Impact Doors",
                    parentFilter: "filter.p.m.custom.product_category=Impact"
                }
            ]
        },
        "Metal": {
            topFilter: "filter.p.m.custom.product_category=Metal",
            topLink: "/collections/all?filter.p.m.custom.product_category=Metal",
            items: []
        },
        "Fiberglass": {
            topFilter: "filter.p.m.custom.product_category=Fiberglass",
            topLink: "/collections/all?filter.p.m.custom.product_category=Fiberglass",
            items: []
        },
        "White Oak": {
            topFilter: "filter.p.m.custom.product_category=White Oak",
            topLink: "/collections/all?filter.p.m.custom.product_category=White Oak",
            items: []
        }
    };

    // Cache for fetched filter data (keyed by parentFilter)
    const filterCache = {};

    function getPersistentCache(key) {
        try {
            const cached = localStorage.getItem(CACHE_KEY_PREFIX + key);
            if (!cached) return null;
            const data = JSON.parse(cached);
            if (Date.now() - data.timestamp > CACHE_DURATION) {
                localStorage.removeItem(CACHE_KEY_PREFIX + key);
                return null;
            }
            return data.payload;
        } catch (e) {
            return null;
        }
    }

    function setPersistentCache(key, payload) {
        try {
            localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({
                timestamp: Date.now(),
                payload: payload
            }));
        } catch (e) {
            console.warn('ETO Menu: Cache write failed', e);
        }
    }

    /**
     * Fetch available filter values from Shopify
     */
    async function fetchFilterValues(parentFilter) {
        // 1. Check Memory Cache
        if (filterCache[parentFilter]) return filterCache[parentFilter];

        // 2. Check Persistent Cache (localStorage)
        const cached = getPersistentCache(parentFilter);
        if (cached) {
            filterCache[parentFilter] = cached;
            return cached;
        }

        // 3. Network Fetch
        try {
            const url = `/collections/all?view=filters-api&${parentFilter}`;
            // Removed cache-busting timestamp from URL to allow browser caching if configured, but keeping API clean
            const response = await fetch(url);
            const text = await response.text();
            const data = JSON.parse(text.trim());

            const filterMap = {};
            if (data.filters) {
                data.filters.forEach(filter => {
                    filterMap[filter.param_name] = filter.values
                        .filter(v => v.count > 0)
                        .map(v => ({ label: v.label, value: v.value, count: v.count }));
                });
            }

            // Save to caches
            filterCache[parentFilter] = filterMap;
            setPersistentCache(parentFilter, filterMap);

            return filterMap;
        } catch (err) {
            console.warn('ETO Menu: Failed to fetch filters for', parentFilter, err);
            return {};
        }
    }

    /**
     * Initialize
     */
    async function initStaticMenu() {
        console.log('ETO Dynamic Menu: Initializing...');
        await Promise.all([
            renderMenuLists()
        ]);
    }

    /**
     * Render the lists (both Sidebar and Navbar specific ones)
     */
    async function renderMenuLists() {
        const containers = document.querySelectorAll('.eto-sidebar-categories, [data-dynamic-categories]');
        if (containers.length === 0) return;

        // 1. Fetch all necessary filter data first
        const allParentFilters = new Set();
        Object.values(STATIC_CATEGORIES).forEach(cat => {
            if (cat.items) {
                const collectFilters = (items) => {
                    items.forEach(item => {
                        if (item.parentFilter) allParentFilters.add(item.parentFilter);
                        if (item.children) collectFilters(item.children);
                    });
                };
                collectFilters(cat.items);
            }
            if (cat.topFilter) allParentFilters.add(cat.topFilter);
        });

        const filterData = {};
        for (const parentFilter of allParentFilters) {
            filterData[parentFilter] = await fetchFilterValues(parentFilter);
        }

        // 2. Render content
        containers.forEach(container => {
            const specificKey = container.getAttribute('data-dynamic-categories');

            // If it's a specific Navbar Dropdown (e.g. "Interior Doors", "Exterior Doors")
            if (specificKey && STATIC_CATEGORIES[specificKey]) {
                const config = STATIC_CATEGORIES[specificKey];
                let availableItems = getAvailableItems(config.items, filterData, config.topFilter);

                // --- HYBRID MODE: Disabled per user request ---
                // Only showing strictly what is defined in STATIC_CATEGORIES
                // --------------------------------------------------------------------------

                // DO NOT clear container.innerHTML as it removes the parent <a> tag!
                // Instead, find the inner list and update it.

                const existingList = container.querySelector('ul');
                if (existingList) {
                    existingList.innerHTML = renderNavbarItems(availableItems);
                    if (!existingList.classList.contains('eto-dropdown')) {
                        existingList.classList.add('eto-dropdown');
                    }
                } else {
                    let list = document.createElement('ul');
                    list.className = 'eto-dropdown door-categories__list';
                    list.innerHTML = renderNavbarItems(availableItems);
                    container.appendChild(list);
                }
                return;
            }

            // Standard Sidebars (Render All Categories as Accordions)
            let list = container.querySelector('.door-categories__list');
            if (!list) {
                container.innerHTML = '<ul class="door-categories__list"></ul>';
                list = container.querySelector('.door-categories__list');
            }

            let html = '';

            for (const [topCategory, config] of Object.entries(STATIC_CATEGORIES)) {
                let availableItems = getAvailableItems(config.items, filterData, config.topFilter);

                // --- HYBRID MODE (Sidebar): Disabled per user request ---
                // Only showing strictly what is defined in STATIC_CATEGORIES
                // -----------------------------

                const hasSub = availableItems.length > 0;

                html += `
                    <li class="door-categories__item" data-category="${topCategory}">
                        <div class="door-categories__link">
                            <a href="${config.topLink}" class="door-categories__label" style="text-transform: uppercase;">
                                ${topCategory}
                            </a>
                            ${hasSub ? `
                            <button type="button" class="door-categories__plus door-categories__toggle" aria-expanded="false">
                                +
                            </button>` : ''}
                        </div>
                        ${hasSub ? '<ul class="door-categories__subcategories">' : ''}
                        ${hasSub ? renderLevel2Items(availableItems) : ''}
                        ${hasSub ? '</ul>' : ''}
                    </li>
                `;
            }

            list.innerHTML = html;
            attachToggleListeners(list);
        });
    }

    /**
     * Render Navbar Items (Recursive for nested flyouts)
     */
    function renderNavbarItems(items) {
        let html = '';
        items.forEach(item => {
            if (item.isLink) {
                // Direct Link
                html += `
                    <li class="eto-dropdown-item">
                        <a href="${item.href}">
                            ${item.name} 
                        </a>
                    </li>
                `;
            } else if (item.isGroup && item.children && item.children.length > 0) {
                // Group with Submenu (Flyout)
                // RECURSIVE CALL HERE
                const childrenHtml = renderNavbarItems(item.children);

                html += `
                    <li class="eto-dropdown-item has-children">
                        <a href="#" onclick="event.preventDefault();">
                            ${item.name}
                            <span class="arrow-right">▶</span>
                        </a>
                        <ul class="eto-flyout eto-dynamic-flyout">
                            ${childrenHtml}
                        </ul>
                    </li>
                `;
            }
        });
        return html;
    }

    /**
     * Helper to process config items against fetched filter data
     */
    function getAvailableItems(items, filterData, fallbackParentFilter) {
        if (!items) return [];

        return items.map(item => {
            const parentFilter = item.parentFilter || fallbackParentFilter;
            const validData = filterData[parentFilter] || {};

            // Check if this item is a Group
            if (item.isGroup && item.children) {
                // Recurse for children
                const availableChildren = getAvailableItems(item.children, filterData, parentFilter);

                return { ...item, children: availableChildren, isGroup: true };
            }

            // Direct Link / Filter Item
            if (item.filterValue) {
                // The param defaults to product_category for most sub-items unless specified
                const param = item.filterParam || "filter.p.m.custom.product_category";
                const options = validData[param] || [];
                const match = options.find(o => o.label === item.filterValue || o.value === item.filterValue);

                const itemValue = match ? match.value : item.filterValue;
                // Encode the value, but replace %20 with + for cleaner URLs
                const itemFilter = `${param}=${encodeURIComponent(itemValue).replace(/%20/g, '+')}`;

                // Only use the subcategory filter, NOT parent + child combined
                let finalQuery = itemFilter;

                return {
                    ...item,
                    count: match ? match.count : 0,
                    href: `/collections/all?${finalQuery}`,
                    isLink: true
                };
            }

            return item;
        });
    }

    /**
     * Render Level 2 Items (Children of Top Category) - Sidebar specific (Recursive)
     */
    function renderLevel2Items(items) {
        let html = '';
        items.forEach(item => {
            if (item.isLink) {
                html += `
                    <li class="door-categories__subitem">
                        <a href="${item.href}" class="door-categories__sublink">
                            ${item.name} 
                        </a>
                    </li>
                `;
            } else if (item.isGroup && item.children && item.children.length > 0) {
                // Recursive call for children
                const childrenHtml = renderLevel2Items(item.children);

                html += `
                    <li class="door-categories__subitem has-children">
                        <div class="door-categories__subrow sub-group-toggle">
                            <a href="#" class="door-categories__sublink" style="flex-grow:1;" onclick="event.preventDefault();">${item.name}</a>
                            <button type="button" class="door-categories__subtoggle door-categories__toggle-inner" aria-expanded="false">+</button>
                        </div>
                        <ul class="door-categories__level3" style="display:none; padding-left: 15px;">
                            ${childrenHtml}
                        </ul>
                    </li>
                `;
            }
        });
        return html;
    }

    /**
     * Attach accordion toggle listeners
     */
    function attachToggleListeners(container) {
        // Level 1 Toggles
        container.querySelectorAll('.door-categories__toggle').forEach(toggle => {
            toggle.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                const item = this.closest('.door-categories__item');
                const isExpanded = item.classList.contains('is-expanded');

                if (isExpanded) {
                    item.classList.remove('is-expanded');
                    this.setAttribute('aria-expanded', 'false');
                    this.textContent = '+';
                } else {
                    item.classList.add('is-expanded');
                    this.setAttribute('aria-expanded', 'true');
                    this.textContent = '−';
                }
            });
        });

        // Level 2+ Toggles (Recursive Inner Groups)
        // Use event delegation for robust handling of recursive structures
        // We attach to the container and listen for clicks on any toggle-inner or sub-group-toggle

        container.addEventListener('click', function (e) {
            const target = e.target;
            const toggleBtn = target.closest('.door-categories__toggle-inner');
            const toggleRow = target.closest('.sub-group-toggle');

            if (toggleBtn || toggleRow) {
                // If clicked strictly on the toggle button OR the row (if row is clickable for toggle)
                // The original logic allowed clicking the row to toggle. 
                // Let's ensure we find the correct elements.

                let btn, row;
                if (toggleBtn) {
                    btn = toggleBtn;
                    row = btn.closest('.sub-group-toggle');
                    e.stopPropagation(); // Stop bubbling if clicked directly on button
                } else if (toggleRow) {
                    row = toggleRow;
                    btn = row.querySelector('.door-categories__toggle-inner');
                }

                if (btn && row) {
                    e.preventDefault();

                    const parentLi = row.closest('li.has-children');
                    // Find the immediate UL child of this LI. 
                    // Since we use recursive structure, there might be nested ULs.
                    // valid structure: LI > DIV.subrow > UL

                    const ul = Array.from(parentLi.children).find(child => child.tagName === 'UL');

                    if (ul) {
                        if (ul.style.display === 'none') {
                            ul.style.display = 'block';
                            btn.textContent = '−';
                        } else {
                            ul.style.display = 'none';
                            btn.textContent = '+';
                        }
                    }
                }
            }
        });
    }

    // Auto-Init
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStaticMenu);
    else initStaticMenu();

})();
