const fs = require('fs');
const path = require('path');

const shopifyCsvPath = '/Users/saurabhkuntal/Downloads/Doors - Shopify (1).csv';
const magentoJsonPath = path.join(__dirname, 'all_magento_products.json');
const outputPath = '/Users/saurabhkuntal/Downloads/SKU_to_Full_Name_Mapping.csv';

// 1. Load Magento Products
const magentoProducts = JSON.parse(fs.readFileSync(magentoJsonPath, 'utf8'));
const magentoBySku = {};
for (const p of magentoProducts) {
    if (p.sku && p.name) {
        magentoBySku[p.sku.trim().toLowerCase()] = p.name.trim();
        const baseSku = p.sku.trim().replace(/-\d+X\d+$/i, '').toLowerCase();
        if (!magentoBySku[baseSku]) {
            magentoBySku[baseSku] = p.name.trim();
        }
    }
}

// 2. Read Shopify CSV and collect unique Door Models and SKUs
const lines = fs.readFileSync(shopifyCsvPath, 'utf8').split(/\r?\n/);
const header = lines[0].split(',');

// Find indices
let modelIndex = -1;
let skuIndex = -1;
let handleIndex = -1;

const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
for (let i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase() === 'door model') modelIndex = i;
    if (headers[i].toLowerCase() === 'variant sku') skuIndex = i;
    if (headers[i].toLowerCase() === 'handle') handleIndex = i;
}

// Parse CSV lines carefully (handling commas inside quotes)
function parseCsvLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
            result.push(cur.trim().replace(/^"|"$/g, ''));
            cur = '';
        } else {
            cur += c;
        }
    }
    result.push(cur.trim().replace(/^"|"$/g, ''));
    return result;
}

const uniqueModels = new Set();
const uniqueSkus = new Set();

for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    if (modelIndex >= 0 && cols[modelIndex]) uniqueModels.add(cols[modelIndex]);
    if (skuIndex >= 0 && cols[skuIndex]) uniqueSkus.add(cols[skuIndex]);
    if (handleIndex >= 0 && cols[handleIndex]) uniqueModels.add(cols[handleIndex]);
}

console.log(`Found ${uniqueModels.size} unique Door Models/Handles and ${uniqueSkus.size} unique SKUs in Doors - Shopify (1).csv`);

// 3. Match each unique Door Model and SKU with full string name
const matchedMap = new Map();

// Match Door Models first
for (const model of uniqueModels) {
    const lower = model.toLowerCase();
    if (magentoBySku[lower]) {
        matchedMap.set(model, magentoBySku[lower]);
    } else {
        const clean = lower.replace(/-/g, '');
        if (magentoBySku[clean]) {
            matchedMap.set(model, magentoBySku[clean]);
        }
    }
}

// Also match Variant SKUs if not already matched
for (const sku of uniqueSkus) {
    if (!matchedMap.has(sku)) {
        const lower = sku.toLowerCase();
        if (magentoBySku[lower]) {
            matchedMap.set(sku, magentoBySku[lower]);
        } else {
            const base = lower.replace(/-\d+X\d+$/i, '');
            if (magentoBySku[base]) {
                matchedMap.set(sku, magentoBySku[base]);
            }
        }
    }
}

// Write to CSV
let outCsv = '"Door Model / SKU","Full String Name"\n';
for (const [key, name] of matchedMap.entries()) {
    const escapedKey = key.replace(/"/g, '""');
    const escapedName = name.replace(/"/g, '""');
    outCsv += `"${escapedKey}","${escapedName}"\n`;
}

fs.writeFileSync(outputPath, outCsv, 'utf8');
console.log(`✅ Filtered CSV generated at: ${outputPath} with ${matchedMap.size} exact mappings for Doors - Shopify (1).csv!`);
