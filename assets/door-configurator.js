/**
 * Door Configurator – 100% Dynamic from JSON Metafield
 * Reads product.metafields.custom.door_options and builds all option groups.
 *
 * Key points about the JSON data:
 * - Options may have duplicate titles (e.g. two "Handing" groups).
 *   The FIRST occurrence is for "Single Door", the SECOND for "Double Door".
 * - The "Size" option prices are ABSOLUTE prices (not addons).
 * - All other option prices are ADDITIVE on top of the selected size price.
 * - A trailing option titled "Your product is now configured" is informational only.
 */
document.addEventListener('DOMContentLoaded', () => {
    const mount = document.getElementById('door-configurator-options');
    const wrapper = document.getElementById('door-configurator-mount');
    const jsonEl = document.getElementById('door-options-json');
    if (!mount || !jsonEl || !wrapper) return;

    let rawOptions;
    try {
        const raw = JSON.parse(jsonEl.textContent);
        // raw is either an array or a JSON-encoded string of an array
        rawOptions = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
        console.error('Door Configurator: Could not parse options JSON', e);
        return;
    }

    if (!Array.isArray(rawOptions) || rawOptions.length === 0) return;

    const formId = wrapper.dataset.productFormId;
    const sectionId = wrapper.dataset.sectionId;

    // ─── De-duplicate & group context-dependent options ────────────────────
    //  If two options share a title, 1st = "Single Door" context, 2nd = "Double Door" context.
    //  We merge them into one group with conditional value sets.
    const optionGroups = [];
    const seenTitles = {};

    rawOptions.forEach(opt => {
        if (!opt.title || opt.title === 'Your product is now configured') return;
        if (opt.type === 'field') return; // Skip informational text fields

        // Normalize title to catch things like "Pre Hanging" vs "Pre hanging"
        const normalizedTitle = opt.title.trim().toLowerCase();

        if (seenTitles[normalizedTitle] !== undefined) {
            // Second occurrence
            const idx = seenTitles[normalizedTitle];

            // Only 'Handing' and 'Size' might legitimately need Single vs Double door context differences
            if (normalizedTitle === 'handing' || normalizedTitle === 'size') {
                optionGroups[idx].doubleValues = opt.values || [];
            }
            // For all other options (like Pre hanging), the first occurrence is authoritative
            // and we strictly ignore any duplicates that Magento appended.
        } else {
            seenTitles[normalizedTitle] = optionGroups.length;
            optionGroups.push({
                title: opt.title,           // Keep original case for display/cart properties
                normalizedTitle: normalizedTitle,
                type: opt.type,
                required: opt.required,
                order: opt.order,
                singleValues: opt.values || [],  // Single door OR default values
                doubleValues: null               // Will be set if a duplicate with DIFFERENT values exists
            });
        }
    });

    // Sort by order
    optionGroups.sort((a, b) => a.order - b.order);

    // ─── State ─────────────────────────────────────────────────────────────
    const state = {};

    // ─── Render each option group ──────────────────────────────────────────
    optionGroups.forEach((group, index) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'door-configurator__option-group';
        groupDiv.id = `dc-group-${index}`;

        const label = document.createElement('label');
        label.className = 'form__label';
        label.setAttribute('for', `dc-select-${index}`);
        label.innerHTML = group.title + (group.required ? ' <span class="door-configurator__required">*</span>' : '');
        groupDiv.appendChild(label);

        const selectWrapper = document.createElement('div');
        selectWrapper.className = 'select';

        const select = document.createElement('select');
        select.id = `dc-select-${index}`;
        select.className = 'select__select door-configurator__select';
        select.name = `properties[${group.title}]`;
        select.setAttribute('form', formId);
        if (group.required) select.setAttribute('required', '');
        select.dataset.groupIndex = index;
        select.dataset.groupTitle = group.title;

        selectWrapper.appendChild(select);

        // Caret icon (Dawn style)
        const caret = document.createElement('span');
        caret.className = 'svg-wrapper';
        caret.innerHTML = '<svg aria-hidden="true" focusable="false" class="icon icon-caret" viewBox="0 0 10 6"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.354.646a.5.5 0 00-.708 0L5 4.293 1.354.646a.5.5 0 00-.708.708l4 4a.5.5 0 00.708 0l4-4a.5.5 0 000-.708z" fill="currentColor"/></svg>';
        selectWrapper.appendChild(caret);

        groupDiv.appendChild(selectWrapper);

        // Info text for price
        const priceNote = document.createElement('span');
        priceNote.className = 'door-configurator__price-note caption';
        priceNote.id = `dc-price-note-${index}`;
        groupDiv.appendChild(priceNote);

        mount.appendChild(groupDiv);

        // Populate initial values
        populateSelect(select, group.singleValues, group.title === 'Size');

        // Listen for changes
        select.addEventListener('change', () => {
            state[group.title] = select.value;
            onOptionChange();
        });
    });

    // ─── Populate a <select> with values ───────────────────────────────────
    function populateSelect(select, values, isSize) {
        select.innerHTML = '';
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '-- Select --';
        noneOpt.dataset.price = '0';
        noneOpt.dataset.priceType = 'fixed';
        select.appendChild(noneOpt);

        (values || []).forEach(val => {
            const opt = document.createElement('option');
            const price = parseFloat(val.price) || 0;
            let displaySuffix = '';

            if (price > 0) {
                if (isSize) {
                    // Size = absolute price, show as "= $X"
                    displaySuffix = ` = $${formatNumber(price)}`;
                } else {
                    displaySuffix = ` (+$${formatNumber(price)})`;
                }
            }

            opt.value = val.title;
            opt.textContent = val.title + displaySuffix;
            opt.dataset.price = price;
            opt.dataset.priceType = val.price_type || 'fixed';
            select.appendChild(opt);
        });
    }

    // ─── When any option changes ───────────────────────────────────────────
    function onOptionChange() {
        // 1. Check if "Door Configuration" changed → swap context-dependent options
        const doorConfigGroup = optionGroups.find(g => g.title === 'Door Configuration');
        if (doorConfigGroup) {
            const doorConfigVal = state['Door Configuration'] || '';
            const isDouble = doorConfigVal === 'Double Door';

            optionGroups.forEach((group, index) => {
                if (group.doubleValues) {
                    const select = document.getElementById(`dc-select-${index}`);
                    if (!select) return;
                    const isSize = group.title === 'Size';
                    const newValues = isDouble ? group.doubleValues : group.singleValues;
                    const currentVal = select.value;
                    populateSelect(select, newValues, isSize);
                    // Try to preserve selection
                    const match = Array.from(select.options).find(o => o.value === currentVal);
                    if (match) {
                        select.value = currentVal;
                    } else {
                        select.value = '';
                        state[group.title] = '';
                    }
                }
            });
        }

        // 1.5 Check if Pre-hanging was declined and update required attributes
        let prehangDeclined = false;
        let prehangIndex = -1;
        const prehangKey = Object.keys(state).find(k => k.toLowerCase() === 'pre hanging');
        if (prehangKey && state[prehangKey] && state[prehangKey].includes('No (Door Only)')) {
            prehangDeclined = true;
        }

        // Find the exact index of the Pre-hanging option so we only skip options AFTER it
        for (let i = 0; i < optionGroups.length; i++) {
            if (optionGroups[i].title.toLowerCase() === 'pre hanging') {
                prehangIndex = i;
                break;
            }
        }

        optionGroups.forEach((group, index) => {
            const select = document.getElementById(`dc-select-${index}`);
            if (!select) return;

            if (prehangDeclined && prehangIndex !== -1 && index > prehangIndex) {
                select.removeAttribute('required');
                // Also clear its state if it was declined to ensure no lingering data
                select.value = '';
                state[group.title] = '';
            } else if (group.required) {
                // Restore required attribute if prehanging changes back to Yes
                select.setAttribute('required', '');
            }
        });

        // 2. Recalculate total price
        calculateAndDisplayPrice();
    }

    // ─── Calculate total price ─────────────────────────────────────────────
    function calculateAndDisplayPrice() {
        let basePrice = 0;
        let addons = 0;

        optionGroups.forEach((group, index) => {
            const select = document.getElementById(`dc-select-${index}`);
            if (!select) return;
            const selectedOpt = select.options[select.selectedIndex];
            if (!selectedOpt) return;

            const price = parseFloat(selectedOpt.dataset.price) || 0;

            if (group.title === 'Size') {
                // Size prices are ABSOLUTE prices (they replace the base)
                basePrice = price;
            } else {
                // All others are additive
                if (price > 0) addons += price;
            }
        });

        const totalPrice = basePrice + addons;

        // Update the main price display on the page
        if (totalPrice > 0) {
            const priceDisplays = document.querySelectorAll('.price-item--regular, .price-item--sale');
            priceDisplays.forEach(el => {
                el.textContent = `$${formatNumber(totalPrice)}`;
            });
        }
    }

    // ─── Format number with commas ─────────────────────────────────────────
    function formatNumber(num) {
        return Number(num).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    // ─── Validation on form submit ─────────────────────────────────────────
    const form = document.getElementById(formId);
    if (form) {
        form.addEventListener('submit', (e) => {
            let valid = true;

            // Check if Pre-hanging was declined
            let prehangDeclined = false;
            let prehangIndex = -1;
            const prehangKey = Object.keys(state).find(k => k.toLowerCase() === 'pre hanging');
            if (prehangKey && state[prehangKey] && state[prehangKey].includes('No (Door Only)')) {
                prehangDeclined = true;
            }

            // Find the exact index of the Pre-hanging option so we only skip options AFTER it
            for (let i = 0; i < optionGroups.length; i++) {
                if (optionGroups[i].title.toLowerCase() === 'pre hanging') {
                    prehangIndex = i;
                    break;
                }
            }

            optionGroups.forEach((group, index) => {
                const select = document.getElementById(`dc-select-${index}`);
                if (!select) return;

                // If this is an option AFTER pre-hanging and pre-hanging is declined, skip its validation
                if (prehangDeclined && prehangIndex !== -1 && index > prehangIndex) {
                    select.classList.remove('error');
                    return; // Skip validation for this option
                }

                if (select.hasAttribute('required') && !select.value) {
                    valid = false;
                    select.classList.add('error');
                } else {
                    select.classList.remove('error');
                }
            });

            if (!valid) {
                e.preventDefault();
                e.stopImmediatePropagation();
                alert('Please select all required door options before adding to cart.');
            }
        });
    }
});
