const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'magento_options.json');
const outputPath = path.join(__dirname, 'all_unique_options_and_values.json');

try {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  
  // Structure to hold our data: { "Question Title": Set(["Value 1", "Value 2"]) }
  const optionTaxonomy = {};

  // Helper to extract values
  function extractValues(title, valObj) {
      if (valObj && valObj.title) {
          const valTitle = valObj.title.trim();
          
          // Optionally strip out pricing from the value title (e.g. "Mahogany (+$199)" -> "Mahogany")
          // If the user wants EXACT strings as they appear in Magento, we keep the price.
          // Let's strip the price so the UI/Image request list is cleaner:
          const cleanTitle = valTitle.replace(/\s*\(\+\$[0-9,.]+\)/g, '').replace(/\s*=\s*\$[0-9,.]+/g, '').replace(/\s*\+\$[0-9,.]+/g, '').trim();

          optionTaxonomy[title].add(cleanTitle);
      }
  }

  for (const sku in data) {
    const options = data[sku];
    if (Array.isArray(options)) {
      for (const option of options) {
        if (option.title) {
          const optTitle = option.title.trim();
          
          if (!optionTaxonomy[optTitle]) {
              optionTaxonomy[optTitle] = new Set();
          }

          let vals = option.values;
          if (!vals) continue;
          
          // Magento SOAP API sometimes wraps array in .item
          if (vals.item) {
              vals = vals.item;
          }
          
          if (Array.isArray(vals)) {
              for (const val of vals) extractValues(optTitle, val);
          } else if (typeof vals === 'object') {
              extractValues(optTitle, vals);
          }
        }
      }
    }
  }

  // Convert Sets to Arrays and sort them for the final JSON output
  const result = {};
  for (const key of Object.keys(optionTaxonomy).sort()) {
      result[key] = Array.from(optionTaxonomy[key]).sort();
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Success! Found ${Object.keys(result).length} unique Option Titles.`);
  console.log(`Saved to: ${outputPath}`);
} catch (error) {
  console.error('Error processing file:', error.message);
}
