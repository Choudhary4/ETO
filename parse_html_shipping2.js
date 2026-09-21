const fs = require('fs');

const htmlText = fs.readFileSync('shipping-policy-html.txt', 'utf8');
const bodyMatch = htmlText.match(/<body>([\s\S]*?)<\/body>/i);

if (!bodyMatch) {
    console.error("Could not find body tag");
    process.exit(1);
}

let bodyContent = bodyMatch[1].trim();
bodyContent = bodyContent.replace(/class="p\d+"/g, '');
bodyContent = bodyContent.replace(/class="ul\d+"/g, '');
bodyContent = bodyContent.replace(/class="li\d+"/g, '');
// Replace the top title since it's redundant (page already has a title)
bodyContent = bodyContent.replace(/<p><b>ETO DOORS CORP\.<\/b><\/p>/i, '');
bodyContent = bodyContent.replace(/<p><b>Shipping Policy<\/b><\/p>/i, '');

// Convert <p><b>1. Overview</b></p> to <h2>1. Overview</h2>
bodyContent = bodyContent.replace(/<p>\s*<b>(\d+\.\s+[^<]+)<\/b>\s*<\/p>/g, '<h2>$1</h2>');

// Add some margins to paragraphs
bodyContent = bodyContent.replace(/<p>/g, '<p style="margin-bottom: 15px;">');

const newJson = {
  "sections": {
    "main": {
      "type": "eto-shipping-delivery",
      "blocks": {
        "lead_time": {
          "type": "info_card",
          "settings": {
            "icon": "clock",
            "title": "Lead Times",
            "text": "Standard orders ship within 3-5 business days. Custom orders vary by complexity."
          }
        },
        "freight": {
          "type": "info_card",
          "settings": {
            "icon": "truck",
            "title": "Nationwide Freight",
            "text": "Premium LTL carriers ensure safe delivery with specialized liftgate service."
          }
        },
        "pickup": {
          "type": "info_card",
          "settings": {
            "icon": "home",
            "title": "Local Pickup",
            "text": "Available at our Los Angeles warehouse. Save on shipping costs."
          }
        },
        "inspection": {
          "type": "info_card",
          "settings": {
            "icon": "search",
            "title": "Easy Inspection",
            "text": "Always inspect your door upon arrival before signing the delivery receipt."
          }
        },
        "full_policy": {
          "type": "content_section",
          "settings": {
            "heading": "",
            "content": bodyContent
          }
        }
      },
      "block_order": [
        "lead_time",
        "freight",
        "pickup",
        "inspection",
        "full_policy"
      ],
      "settings": {
        "title": "Shipping & Delivery",
        "subtitle": "Everything you need to know about receiving your artisan doors."
      }
    }
  },
  "order": ["main"]
};

fs.writeFileSync('templates/page.shipping-and-delivery.json', JSON.stringify(newJson, null, 2));
console.log('Successfully updated templates/page.shipping-and-delivery.json with formatted HTML');
