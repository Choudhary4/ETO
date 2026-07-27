const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, 'all_magento_products.json');
const outputPath = path.join(__dirname, 'SKU_to_Full_Name_Mapping.csv');

const rawData = fs.readFileSync(jsonPath, 'utf8');
const products = JSON.parse(rawData);

// Map to avoid duplicates and hold SKU -> Full Name
const skuMap = new Map();

for (const p of products) {
    if (p.sku && p.name) {
        const sku = p.sku.trim();
        const name = p.name.trim();
        skuMap.set(sku, name);
        
        // Also add base SKU without size suffix like "-36X80" if not already present
        const baseSku = sku.replace(/-\d+X\d+$/i, '');
        if (!skuMap.has(baseSku)) {
            skuMap.set(baseSku, name);
        }
    }
}

// Build CSV
let csv = '"Door Model / SKU","Full String Name"\n';
for (const [sku, name] of skuMap.entries()) {
    const escapedSku = sku.replace(/"/g, '""');
    const escapedName = name.replace(/"/g, '""');
    csv += `"${escapedSku}","${escapedName}"\n`;
}

fs.writeFileSync(outputPath, csv, 'utf8');
console.log(`✅ CSV generated successfully at: ${outputPath} (Total Unique SKUs/Models: ${skuMap.size})`);
