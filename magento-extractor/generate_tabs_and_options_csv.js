require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────
const SHOPIFY_CSV   = '/Users/saurabhkuntal/Downloads/Doors - Shopify (1).csv';
const TABS_JSON     = path.join(__dirname, 'magento_tabs_data.json');
const OPTIONS_JSON  = path.join(__dirname, 'shopify_ready_options.json');
const CUSTOM_OPT    = path.join(__dirname, 'custom_door_options.json');
const OUTPUT_CSV    = '/Users/saurabhkuntal/Downloads/Matrixify_Product_Metafields.csv';

// ── Helpers ────────────────────────────────────────────────────────────────
// Properly escape a value for CSV: wrap in quotes, double any internal quotes
function csvCell(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    return '"' + str.replace(/"/g, '""') + '"';
}

// Parse a CSV line respecting quoted fields
function parseCsvLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
            result.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    result.push(cur);
    return result;
}

// ── Load source data ───────────────────────────────────────────────────────
console.log('📂 Loading source JSON files...');
const tabsData    = JSON.parse(fs.readFileSync(TABS_JSON, 'utf8'));      // { "7001": { overview, specification, lead_time }, ... }
const stdOptions  = JSON.parse(fs.readFileSync(OPTIONS_JSON, 'utf8'));   // { "7001": [ { title, type, values... } ], ... }
const customOpts  = JSON.parse(fs.readFileSync(CUSTOM_OPT, 'utf8'));     // { "LOUVER": { resolved_sku, options: [...] }, ... }

// Build case-insensitive lookup maps
function buildLowerMap(obj) {
    const map = {};
    for (const key of Object.keys(obj)) {
        map[key.toLowerCase().trim()] = obj[key];
    }
    return map;
}
const tabsMap       = buildLowerMap(tabsData);
const stdOptionsMap = buildLowerMap(stdOptions);
const customOptsMap = buildLowerMap(customOpts);

// ── Read Shopify CSV & extract unique Handle+DoorModel rows ────────────────
console.log('📂 Reading Shopify CSV...');
const shopifyLines = fs.readFileSync(SHOPIFY_CSV, 'utf8').split(/\r?\n/);
const headers = parseCsvLine(shopifyLines[0]);

const colHandle   = headers.findIndex(h => h.trim().toLowerCase() === 'handle');
const colDoorModel = headers.findIndex(h => h.trim().toLowerCase() === 'door model');
const colSku       = headers.findIndex(h => h.trim().toLowerCase() === 'variant sku');

if (colHandle === -1) { console.error('❌ "Handle" column not found!'); process.exit(1); }
if (colDoorModel === -1) { console.error('❌ "Door Model" column not found!'); process.exit(1); }

// Collect unique handles (one row per Handle since tabs/options are per product, not variant)
const seenHandles = new Set();
const productRows = [];

for (let i = 1; i < shopifyLines.length; i++) {
    const line = shopifyLines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const handle    = (cols[colHandle]    || '').trim();
    const doorModel = (cols[colDoorModel] || '').trim();
    const sku       = (cols[colSku]       || '').trim();
    // Skip corrupt rows: a valid handle should not contain commas or "active/shopify" 
    if (!handle || handle.includes(',') || handle.toLowerCase().includes('shopify')) continue;
    if (seenHandles.has(handle)) continue;
    seenHandles.add(handle);
    productRows.push({ handle, doorModel, sku });
}

console.log(`✅ Found ${productRows.length} unique products (handles) from Shopify CSV.`);

// ── Match data for each product ────────────────────────────────────────────
let matchedTabs = 0, matchedOptions = 0, noMatch = 0;

// IMPORTANT for Shopify native importer:
// - "Handle" must exactly match the product handle in Shopify
// - Metafield columns follow format: "Column Name (product.metafields.namespace.key)"
// - Type should be "multi_line_text_field" for text metafields, "json" for JSON

// Matrixify metafield column format: "Metafield: namespace.key [type]"
const COL_HANDLE  = 'Handle';
const COL_OVERVIEW = 'Metafield: custom.tab_overview [multi_line_text_field]';
const COL_SPEC    = 'Metafield: custom.tab_specification [multi_line_text_field]';
const COL_LEAD    = 'Metafield: custom.tab_lead_time [multi_line_text_field]';
const COL_OPTIONS = 'Metafield: custom.door_options [json]';

const csvRows = [];
// Header row
csvRows.push([COL_HANDLE, COL_OVERVIEW, COL_SPEC, COL_LEAD, COL_OPTIONS].map(csvCell).join(','));

for (const { handle, doorModel, sku } of productRows) {
    const lHandle    = handle.toLowerCase().trim();
    const lDoorModel = doorModel.toLowerCase().trim();

    // ── Tabs lookup: try handle/doorModel in multiple case variants ──
    const tryKeys = [
        lHandle, lDoorModel,
        handle.toUpperCase().toLowerCase(),   // same as lHandle actually
        handle.toUpperCase(),                  // exact uppercase
        doorModel.toUpperCase(),               // exact uppercase doorModel
    ].map(k => k.trim());

    let tabs = null;
    for (const k of tryKeys) {
        if (tabsMap[k]) { tabs = tabsMap[k]; break; }
    }

    // ── Options lookup: same multi-variant approach ──
    let optionsArr = null;
    for (const k of tryKeys) {
        if (stdOptionsMap[k]) { optionsArr = stdOptionsMap[k]; break; }
    }
    if (!optionsArr) {
        for (const k of tryKeys) {
            const custEntry = customOptsMap[k];
            if (custEntry && custEntry.options) { optionsArr = custEntry.options; break; }
        }
    }

    const overview = tabs?.overview     || '';
    const spec     = tabs?.specification || '';
    const lead     = tabs?.lead_time    || '';
    const options  = optionsArr ? JSON.stringify(optionsArr) : '';

    if (tabs)       matchedTabs++;
    if (optionsArr) matchedOptions++;
    if (!tabs && !optionsArr) { noMatch++; }

    csvRows.push([handle, overview, spec, lead, options].map(csvCell).join(','));
}

// ── Write output ────────────────────────────────────────────────────────────
// Write UTF-8 with BOM so Excel opens correctly without encoding issues
const BOM = '\uFEFF';
fs.writeFileSync(OUTPUT_CSV, BOM + csvRows.join('\n'), 'utf8');

console.log('\n✅ CSV generated successfully!');
console.log(`📄 Output: ${OUTPUT_CSV}`);
console.log(`📊 Total product rows: ${productRows.length}`);
console.log(`📑 Tabs matched      : ${matchedTabs}`);
console.log(`⚙️  Options matched   : ${matchedOptions}`);
console.log(`⚠️  No data found     : ${noMatch}`);
console.log('\n💡 Import this CSV in Shopify Admin → Products → Import → "Overwrite existing products that have the same handle"');
