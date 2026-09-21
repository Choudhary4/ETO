const fs = require('fs');

const rawHtml = fs.readFileSync('terms-of-use-html.txt', 'utf8');
const bodyMatch = rawHtml.match(/<body>([\s\S]*?)<\/body>/i);
let bodyContent = bodyMatch ? bodyMatch[1].trim() : rawHtml;

// Strip useless classes
bodyContent = bodyContent.replace(/\s?class="[^"]+"/g, '');
bodyContent = bodyContent.replace(/<p>\s*<b>ETO DOORS CORP\.<\/b>\s*<\/p>/gi, '');
bodyContent = bodyContent.replace(/<p>\s*<b>Terms of Use<\/b>\s*<\/p>/gi, '');
bodyContent = bodyContent.replace(/<p>\s*<i>Last updated:.*?<\/i>\s*<\/p>/gi, '');

// Parse sections
const lines = bodyContent.split('\n');
let sections = [];
let currentSection = null;

for (let line of lines) {
    let match = line.match(/<p>\s*<b>(\d+\.\s+[^<]+)<\/b>\s*<\/p>/);
    if (match) {
        if (currentSection) sections.push(currentSection);
        let title = match[1];
        let id = 'section' + title.split('.')[0]; // e.g. section1
        currentSection = { id, title, titleHtml: match[0], content: [] };
    } else if (currentSection) {
        currentSection.content.push(line);
    }
}
if (currentSection) sections.push(currentSection);

// Build Sidebar
let sidebarHtml = `
<aside class="bg-surface dark:bg-primary h-screen w-64 sticky top-20 hidden lg:flex flex-col py-8 gap-4 px-4 border-r border-outline-variant/30 overflow-y-auto">
  <div class="mb-6 px-4">
    <h2 class="font-headline-md text-primary dark:text-on-primary mb-1">LEGAL SECTIONS</h2>
    <p class="font-label-md text-on-surface-variant">Terms of Use</p>
  </div>
  <nav class="flex flex-col gap-2">
`;
sections.forEach((sec, index) => {
    let activeClass = index === 0 
        ? "text-secondary dark:text-secondary-fixed-dim font-bold border-l-2 border-secondary pl-4 py-2 flex items-center gap-3 transition-all duration-300 bg-surface-container-low font-label-md uppercase tracking-wider text-label-md" 
        : "text-on-surface-variant dark:text-on-primary-container pl-4 py-2 flex items-center gap-3 transition-all duration-300 hover:bg-surface-container-low font-label-md uppercase tracking-wider text-label-md border-l-2 border-transparent";
    
    // We can use a simple JS script to handle active states, but let's just make them anchor links
    sidebarHtml += `
    <a class="${activeClass}" href="#${sec.id}" onclick="document.querySelectorAll('aside a').forEach(el=>el.className='text-on-surface-variant dark:text-on-primary-container pl-4 py-2 flex items-center gap-3 transition-all duration-300 hover:bg-surface-container-low font-label-md uppercase tracking-wider text-label-md border-l-2 border-transparent'); this.className='text-secondary dark:text-secondary-fixed-dim font-bold border-l-2 border-secondary pl-4 py-2 flex items-center gap-3 transition-all duration-300 bg-surface-container-low font-label-md uppercase tracking-wider text-label-md';">
      ${sec.title.substring(0, 20)}${sec.title.length>20?'...':''}
    </a>`;
});
sidebarHtml += `</nav></aside>`;

// Build Main Content
let mainHtml = `
<main class="flex-1 py-12 px-4 md:px-10 bg-tertiary-fixed/10">
  <div class="max-w-[800px] mx-auto bg-surface-container-lowest rounded-lg shadow-[0_4px_32px_rgba(0,0,0,0.04)] border border-outline-variant/50 p-8 md:p-12">
    <header class="mb-12">
      <h1 class="font-display-lg text-display-lg text-primary mb-4 relative inline-block text-4xl font-bold">
        Terms of Use
        <span class="absolute bottom-0 left-0 w-1/3 h-1 bg-secondary rounded-full"></span>
      </h1>
      <p class="font-body-md text-on-surface-variant mt-4 italic text-gray-500">Last Updated: August 25, 2026</p>
    </header>
    <div class="space-y-12">
`;

sections.forEach(sec => {
    let contentHtml = sec.content.join('\n');
    contentHtml = contentHtml.replace(/<p>/g, '<p class="mb-4">');
    contentHtml = contentHtml.replace(/<ul>/g, '<ul class="list-disc pl-6 space-y-2 mt-2 mb-4">');
    contentHtml = contentHtml.replace(/<b>/g, '<strong class="font-bold text-gray-800">');
    contentHtml = contentHtml.replace(/<\/b>/g, '</strong>');
    
    mainHtml += `
      <section id="${sec.id}">
        <h2 class="font-headline-md text-headline-md text-primary mb-4 text-2xl font-semibold">${sec.title}</h2>
        <div class="font-body-md text-body-md text-on-surface leading-relaxed text-gray-600">
          ${contentHtml}
        </div>
      </section>
    `;
});
mainHtml += `</div></div></main>`;

const tailwindConfig = `
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@400;600&display=swap" rel="stylesheet"/>
<script>
  tailwind.config = {
    corePlugins: { preflight: false },
    darkMode: "class",
    theme: {
      extend: {
        colors: {
          "secondary": "#c2b59b",
          "primary": "#0c1014",
          "surface-container-lowest": "#ffffff",
          "surface": "#f6faff",
          "tertiary-fixed": "#e1e3e4",
          "on-surface-variant": "#44474a",
          "on-surface": "#141d23"
        }
      }
    }
  }
</script>
<style>
  #eto-brand-content { text-align: left; }
</style>
`;

const finalHtml = `
<div id="eto-brand-content" style="display: none; background: #fafafa;">
  ${tailwindConfig}
  <div class="flex flex-1 w-full mx-auto" style="max-width: 1280px;">
    ${sidebarHtml}
    ${mainHtml}
  </div>
</div>
`;

let aboutLiquid = fs.readFileSync('sections/eto-about.liquid', 'utf8');
const startIndex = aboutLiquid.indexOf('<div id="eto-brand-content" style="display: none;');
const endIndex = aboutLiquid.indexOf('<!-- Hidden Impact Rating Content -->');

if (startIndex !== -1 && endIndex !== -1) {
    const before = aboutLiquid.substring(0, startIndex);
    const after = aboutLiquid.substring(endIndex);
    fs.writeFileSync('sections/eto-about.liquid', before + finalHtml + '\n    ' + after);
    console.log("Successfully integrated Stitch UI into eto-about.liquid");
} else {
    console.log("Could not find markers");
}
