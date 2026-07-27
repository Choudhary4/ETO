const fs = require('fs');
const path = require('path');

const CATALOG_FILE = path.join(__dirname, 'all_magento_products.json');
const allProducts = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));

const failedSkus = [
    'MA110-A', 'UTAH', 'CRAFTSMAN 1 LITE', 'CRAFTSMAN 3 LITE',
    'EXWP1L', 'WP1L', 'FD1LSL', 'LOUVER', 'SANTA FE',
    'BAILEY', 'LA PLAYA', 'KANSAS', 'VENTURA', 'KA300V',
    'KA305V', 'ATLANTA', 'AUBURN'
];

console.log(`\n🔍 Fuzzy Matching Against ${allProducts.length} Magento Products...`);
console.log('====================================================\n');

for (const query of failedSkus) {
    const qLower = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    let matches = [];

    // First, try to find direct substring match in sku or name
    for (const p of allProducts) {
        if (!p.sku || !p.name) continue;

        const skuLower = String(p.sku).toLowerCase().replace(/[^a-z0-9]/g, '');
        const nameLower = String(p.name).toLowerCase().replace(/[^a-z0-9]/g, '');

        // Match if query is inside SKU or Name, or vice versa
        if (skuLower.includes(qLower) || qLower.includes(skuLower) ||
            nameLower.includes(qLower) || qLower.includes(nameLower)) {
            matches.push(p);
        }
    }

    if (matches.length > 0) {
        console.log(`✅ Matches for "${query}":`);
        matches.slice(0, 5).forEach(m => {
            console.log(`    - SKU: [${m.sku}] | ID: ${m.product_id} | Name: ${m.name}`);
        });
        if (matches.length > 5) console.log(`      ... and ${matches.length - 5} more`);
    } else {
        console.log(`❌ No matches for "${query}"`);
    }
    console.log('');
}
