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
bodyContent = bodyContent.replace(/<p>\s*<b>ETO DOORS CORP\.<\/b>\s*<\/p>/ig, '');
bodyContent = bodyContent.replace(/<p>\s*<b>Terms of Use<\/b>\s*<\/p>/ig, '');

// Convert <p><b>1. Overview</b></p> to <h2>1. Overview</h2>
bodyContent = bodyContent.replace(/<p>\s*<b>(\d+\.\s+[^<]+)<\/b>\s*<\/p>/g, '<h2 style="font-size:24px; font-weight:700; color:#333; margin-top:30px; margin-bottom:15px; border-bottom:2px solid #c2b59b; padding-bottom:5px; display:inline-block;">$1</h2>');

// Add some margins to paragraphs
bodyContent = bodyContent.replace(/<p>/g, '<p class="eto-text-p" style="margin-bottom: 15px;">');
bodyContent = bodyContent.replace(/<ul>/g, '<ul style="margin-bottom: 15px; padding-left: 20px; list-style-type: disc; color: #555; font-size: 13px; line-height: 1.6;">');
bodyContent = bodyContent.replace(/<li>/g, '<li style="margin-bottom: 5px;">');

let aboutLiquid = fs.readFileSync('sections/eto-about.liquid', 'utf8');

const startIndex = aboutLiquid.indexOf('<div id="eto-brand-content" style="display: none;">');
const endIndex = aboutLiquid.indexOf('<!-- Hidden Impact Rating Content -->');

if (startIndex !== -1 && endIndex !== -1) {
    const before = aboutLiquid.substring(0, startIndex);
    const after = aboutLiquid.substring(endIndex);
    
    const newContent = `<div id="eto-brand-content" style="display: none; max-width: 900px; margin: 0 auto; text-align: left; padding: 20px;">
    <h1 style="font-size:32px; font-weight:bold; margin-bottom:10px;">Terms of Use</h1>
    <p class="eto-text-p" style="margin-bottom:30px; font-style:italic;">Last updated: August 25, 2026</p>
    ${bodyContent}
    </div>\n\n    `;
    
    fs.writeFileSync('sections/eto-about.liquid', before + newContent + after);
    console.log("Successfully replaced eto-brand-content in eto-about.liquid");
} else {
    console.log("Could not find the markers in eto-about.liquid");
}
