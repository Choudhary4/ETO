const fs = require('fs');

const htmlText = fs.readFileSync('terms-of-use-html.txt', 'utf8');
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
bodyContent = bodyContent.replace(/<p>\s*<b>ETO DOORS CORP\.<\/b>\s*<\/p>/ig, '');
bodyContent = bodyContent.replace(/<p>\s*<b>Terms of Use<\/b>\s*<\/p>/ig, '');

// Convert <p><b>1. Overview</b></p> to <h2>1. Overview</h2>
bodyContent = bodyContent.replace(/<p>\s*<b>(\d+\.\s+[^<]+)<\/b>\s*<\/p>/g, '<h2>$1</h2>');

// Add some margins to paragraphs
bodyContent = bodyContent.replace(/<p>/g, '<p style="margin-bottom: 15px;">');

const newJson = {
  "sections": {
    "main": {
      "type": "eto-shipping-delivery",
      "blocks": {
        "full_policy": {
          "type": "content_section",
          "settings": {
            "heading": "",
            "content": bodyContent
          }
        }
      },
      "block_order": [
        "full_policy"
      ],
      "settings": {
        "title": "Terms of Use",
        "subtitle": "Last updated: August 25, 2026"
      }
    }
  },
  "order": ["main"]
};

fs.writeFileSync('templates/page.terms.json', JSON.stringify(newJson, null, 2));
console.log('Successfully created templates/page.terms.json with formatted HTML');
