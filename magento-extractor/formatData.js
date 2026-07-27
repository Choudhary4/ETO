const fs = require('fs');
const data = JSON.parse(fs.readFileSync('magento_options.json', 'utf8'));

const formattedData = {};

let totalOptions = 0;
let totalSkus = 0;

for (const [sku, options] of Object.entries(data)) {
    if (options && !options.error && Array.isArray(options) && options.length > 0) {
        totalSkus++;
        totalOptions += options.length;

        // Clean array
        formattedData[sku] = options.map(opt => ({
            title: opt.title,
            type: opt.type,
            required: opt.is_require,
            order: opt.sort_order,
            values: opt.values ? opt.values.map(val => {
                let valTitle = typeof val.title === 'string' ? val.title : (val.title ? String(val.title) : '');
                return {
                    title: valTitle.replace(/\s*=\s*\$\d+(\.\d+)?\s*/g, '').trim(), // Clean out the ' = $50 ' from titles
                    price: parseFloat(val.price || 0),
                    price_type: val.price_type,
                    order: val.sort_order
                };
            }).sort((a, b) => a.order - b.order) : []
        })).sort((a, b) => a.order - b.order);
    }
}

fs.writeFileSync('shopify_ready_options.json', JSON.stringify(formattedData, null, 2));
console.log('✅ Formatted ' + totalOptions + ' options across ' + totalSkus + ' SKUs.');
