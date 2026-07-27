const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'magento_options.json');
const outputPath = path.join(__dirname, 'unique_door_configurations.json');

try {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const uniqueValues = new Set();
  
  // Helper to extract values
  function extractTitle(valObj) {
      if (valObj && valObj.title) {
          uniqueValues.add(valObj.title.trim());
      }
  }

  for (const sku in data) {
    const options = data[sku];
    if (Array.isArray(options)) {
      for (const option of options) {
        if (option.title && option.title.trim().toLowerCase().includes('configuration')) {
          
          let vals = option.values;
          if (!vals) continue;
          
          // SOAP sometimes wraps in .item
          if (vals.item) {
              vals = vals.item;
          }
          
          if (Array.isArray(vals)) {
              for (const val of vals) extractTitle(val);
          } else if (typeof vals === 'object') {
              extractTitle(vals);
          }
        }
      }
    }
  }

  const result = Array.from(uniqueValues).sort();
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Success! Found ${result.length} unique Door Configuration values.`);
  console.log(`Saved to: ${outputPath}`);
} catch (error) {
  console.error('Error processing file:', error.message);
}
