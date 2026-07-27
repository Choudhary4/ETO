const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync('magento_category_descriptions.json', 'utf8'));
let liquidContent = `{%- assign category_desc = blank -%}\n{%- case category_name -%}\n`;

for (const catName in data) {
    let desc = data[catName].description || data[catName].meta_description;
    if (desc && desc.trim() !== '') {
        // Clean up or escape any raw liquid tags inside the description if they exist (rare, but good practice).
        // Using capture is safe against inner quotes.
        // We replace any stray `{%` or `{{` that might crash Liquid.
        desc = desc.replace(/{%/g, '{ %').replace(/{{/g, '{ {');
        liquidContent += `  {%- when ${JSON.stringify(catName)} -%}\n    {%- capture category_desc -%}\n${desc}\n    {%- endcapture -%}\n`;
    }
}

liquidContent += `{%- endcase -%}\n{{ category_desc }}`;

const outputPath = path.join(__dirname, '../snippets/category-description-mapping.liquid');
fs.writeFileSync(outputPath, liquidContent);
console.log('✅ Snippet generated successfully at ' + outputPath);
