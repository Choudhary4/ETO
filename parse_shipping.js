const fs = require('fs');
const text = fs.readFileSync('shipping-policy-extracted.txt', 'utf8');

const lines = text.split('\n');
let blocks = {};
let block_order = ['lead_time', 'freight', 'pickup', 'inspection']; // keep info cards
let currentSection = '';
let currentTitle = '';
let currentContent = [];

// Base blocks
blocks['lead_time'] = { "type": "info_card", "settings": { "icon": "clock", "title": "Lead Times", "text": "Standard orders ship within 3-5 business days. Custom orders vary by complexity." } };
blocks['freight'] = { "type": "info_card", "settings": { "icon": "truck", "title": "Nationwide Freight", "text": "Premium LTL carriers ensure safe delivery with specialized liftgate service." } };
blocks['pickup'] = { "type": "info_card", "settings": { "icon": "home", "title": "Local Pickup", "text": "Available at our Los Angeles warehouse. Save on shipping costs." } };
blocks['inspection'] = { "type": "info_card", "settings": { "icon": "search", "title": "Easy Inspection", "text": "Always inspect your door upon arrival before signing the delivery receipt." } };

let secCounter = 0;

function saveSection() {
    if (currentTitle) {
        let contentHtml = currentContent.map(line => {
            if (line.startsWith('\t•\t')) {
                return `<ul><li>${line.replace('\t•\t', '').trim()}</li></ul>`;
            } else if (line.trim().length > 0) {
                return `<p>${line.trim()}</p>`;
            }
            return '';
        }).join('').replace(/<\/ul><ul>/g, ''); // merge lists

        let blockId = 'section_' + secCounter;
        blocks[blockId] = {
            "type": "content_section",
            "settings": {
                "heading": currentTitle,
                "content": contentHtml
            }
        };
        block_order.push(blockId);
        secCounter++;
    }
}

for (let i = 3; i < lines.length; i++) { // Skip first 3 lines (title, date)
    let line = lines[i];
    let match = line.match(/^(\d+\.)\s+(.+)/);
    
    if (match) {
        saveSection();
        currentTitle = match[1] + ' ' + match[2];
        currentContent = [];
    } else {
        if (line.trim().length > 0) {
            currentContent.push(line);
        }
    }
}
saveSection();

const newJson = {
  "sections": {
    "main": {
      "type": "eto-shipping-delivery",
      "blocks": blocks,
      "block_order": block_order,
      "settings": {
        "title": "Shipping & Delivery",
        "subtitle": "Effective August 17, 2026"
      }
    }
  },
  "order": ["main"]
};

fs.writeFileSync('templates/page.shipping-and-delivery.json', JSON.stringify(newJson, null, 2));
console.log('Successfully updated templates/page.shipping-and-delivery.json');
