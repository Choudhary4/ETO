const fs = require('fs');

const htmlText = fs.readFileSync('terms-of-use-html.txt', 'utf8');
const bodyMatch = htmlText.match(/<body>([\s\S]*?)<\/body>/i);

if (!bodyMatch) {
    console.error("Could not find body tag");
    process.exit(1);
}

let bodyContent = bodyMatch[1].trim();

// Remove all class="p1" style attributes left by textutil
bodyContent = bodyContent.replace(/\s?class="[^"]+"/g, '');

// Now it's clean HTML like <p><b>ETO DOORS CORP.</b></p>
// Let's remove the first 3 redundant lines (Title, Subtitle, Date)
bodyContent = bodyContent.replace(/<p>\s*<b>ETO DOORS CORP\.<\/b>\s*<\/p>/gi, '');
bodyContent = bodyContent.replace(/<p>\s*<b>Terms of Use<\/b>\s*<\/p>/gi, '');
bodyContent = bodyContent.replace(/<p>\s*<i>Last updated:.*?<\/i>\s*<\/p>/gi, '');

// Convert numbered section headers like <p><b>1. Acceptance...</b></p> into stylish <h2> elements
bodyContent = bodyContent.replace(/<p>\s*<b>(\d+\.\s+[^<]+)<\/b>\s*<\/p>/gi, 
    '<div class="eto-terms-block"><h2 class="eto-terms-heading">$1</h2>');

// But wait, if I add a <div class="eto-terms-block">, I need to close it. 
// Easier to just output the <h2> and let them flow.
bodyContent = bodyContent.replace(/<div class="eto-terms-block"><h2 class="eto-terms-heading">/g, '<h2 class="eto-terms-heading">');
bodyContent = bodyContent.replace(/<h2 class="eto-terms-heading">(\d+\.\s+[^<]+)<\/h2>/g, 
    '<h2 style="font-size: 26px; font-weight: 800; color: #2d2d2d; margin-top: 50px; margin-bottom: 20px; position: relative; padding-bottom: 15px; letter-spacing: -0.5px;">$1<span style="position: absolute; bottom: 0; left: 0; width: 60px; height: 3px; background: #c2b59b;"></span></h2>');

// Style standard paragraphs
bodyContent = bodyContent.replace(/<p>/g, '<p style="font-size: 16px; line-height: 1.8; color: #444; margin-bottom: 20px; font-family: var(--font-body-family);">');

// Style lists
bodyContent = bodyContent.replace(/<ul>/g, '<ul style="margin-bottom: 25px; padding-left: 25px; list-style-type: disc; color: #444; font-size: 16px; line-height: 1.8;">');
bodyContent = bodyContent.replace(/<li>/g, '<li style="margin-bottom: 12px;">');

// Style bold text to look nicer (less harsh black)
bodyContent = bodyContent.replace(/<b>/g, '<strong style="color: #111; font-weight: 700;">');
bodyContent = bodyContent.replace(/<\/b>/g, '</strong>');

let aboutLiquid = fs.readFileSync('sections/eto-about.liquid', 'utf8');

const startIndex = aboutLiquid.indexOf('<div id="eto-brand-content" style="display: none;');
const endIndex = aboutLiquid.indexOf('<!-- Hidden Impact Rating Content -->');

if (startIndex !== -1 && endIndex !== -1) {
    const before = aboutLiquid.substring(0, startIndex);
    const after = aboutLiquid.substring(endIndex);
    
    // Create a beautiful wrapper
    const newContent = `<div id="eto-brand-content" style="display: none; background: #fafafa; padding: 60px 0; font-family: var(--font-body-family);">
    <div style="max-width: 900px; margin: 0 auto; background: #fff; padding: 60px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.03); text-align: left;">
      <h1 style="font-size: 42px; font-weight: 800; color: #111; margin-bottom: 10px; letter-spacing: -1px;">Terms of Use</h1>
      <p style="font-size: 15px; color: #888; font-style: italic; margin-bottom: 40px; border-bottom: 1px solid #eee; padding-bottom: 30px;">Last updated: August 25, 2026</p>
      
      <div class="eto-terms-body">
        ${bodyContent}
      </div>
    </div>
</div>\n\n    `;
    
    fs.writeFileSync('sections/eto-about.liquid', before + newContent + after);
    console.log("Successfully fixed UI for terms page in eto-about.liquid");
} else {
    console.log("Could not find the markers in eto-about.liquid");
}
