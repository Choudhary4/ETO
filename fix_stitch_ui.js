const fs = require('fs');

const rawHtml = fs.readFileSync('terms-of-use-html.txt', 'utf8');
const bodyMatch = rawHtml.match(/<body>([\s\S]*?)<\/body>/i);
let bodyContent = bodyMatch ? bodyMatch[1].trim() : rawHtml;

bodyContent = bodyContent.replace(/\s?class="[^"]+"/g, '');
bodyContent = bodyContent.replace(/<p>\s*<b>ETO DOORS CORP\.<\/b>\s*<\/p>/gi, '');
bodyContent = bodyContent.replace(/<p>\s*<b>Terms of Use<\/b>\s*<\/p>/gi, '');
bodyContent = bodyContent.replace(/<p>\s*<i>Last updated:.*?<\/i>\s*<\/p>/gi, '');

const lines = bodyContent.split('\n');
let sections = [];
let currentSection = null;

for (let line of lines) {
    let match = line.match(/<p>\s*<b>(\d+\.\s+[^<]+)<\/b>\s*<\/p>/);
    if (match) {
        if (currentSection) sections.push(currentSection);
        let title = match[1];
        let id = 'section' + title.split('.')[0];
        currentSection = { id, title, content: [] };
    } else if (currentSection) {
        currentSection.content.push(line);
    }
}
if (currentSection) sections.push(currentSection);

let sidebarHtml = `
<aside class="eto-terms-sidebar">
  <div class="eto-terms-sidebar-header">
    <h2>LEGAL SECTIONS</h2>
    <p>Terms of Use</p>
  </div>
  <nav class="eto-terms-nav">
`;
sections.forEach((sec, index) => {
    let activeClass = index === 0 ? "eto-nav-link active" : "eto-nav-link";
    sidebarHtml += `
    <a class="${activeClass}" href="#${sec.id}" onclick="event.preventDefault(); document.querySelectorAll('.eto-nav-link').forEach(el=>el.classList.remove('active')); this.classList.add('active'); smoothScrollTo(document.getElementById('${sec.id}'), 800);">
      ${sec.title}
    </a>`;
});
sidebarHtml += `</nav></aside>`;

let mainHtml = `
<main class="eto-terms-main">
  <div class="eto-terms-card">
    <header class="eto-terms-header">
      <h1>
        Terms of Use
        <span class="eto-terms-underline"></span>
      </h1>
      <p class="eto-terms-date">Last Updated: August 25, 2026</p>
    </header>
    <div class="eto-terms-content">
`;

sections.forEach(sec => {
    let contentHtml = sec.content.join('\n');
    contentHtml = contentHtml.replace(/<p>/g, '<p class="eto-p">');
    contentHtml = contentHtml.replace(/<ul>/g, '<ul class="eto-ul">');
    contentHtml = contentHtml.replace(/<li>/g, '<li class="eto-li">');
    contentHtml = contentHtml.replace(/<b>/g, '<strong class="eto-strong">');
    contentHtml = contentHtml.replace(/<\/b>/g, '</strong>');
    
    mainHtml += `
      <section id="${sec.id}" class="eto-section">
        <h2>${sec.title}</h2>
        <div class="eto-section-body">
          ${contentHtml}
        </div>
      </section>
    `;
});
mainHtml += `</div></div></main>`;

const customCss = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@400;600&display=swap');

  html {
    scroll-behavior: smooth;
  }

  #eto-brand-content {
    background: #f6faff;
    font-family: 'Source Serif 4', serif;
    color: #141d23;
  }
  .eto-terms-container {
    display: flex;
    max-width: 1440px;
    margin: 0 auto;
    width: 100%;
  }
  .eto-terms-sidebar {
    width: 350px;
    flex-shrink: 0;
    position: sticky;
    top: 20px;
    height: calc(100vh - 40px);
    overflow-y: auto;
    padding: 40px 20px;
    border-right: 1px solid rgba(197, 198, 202, 0.4);
    background: #ffffff;
    margin-top: 40px;
    border-radius: 8px;
  }
  .eto-terms-sidebar-header h2 {
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: #0c1014;
    margin-bottom: 4px;
    letter-spacing: 1px;
  }
  .eto-terms-sidebar-header p {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    color: #44474a;
    margin-bottom: 24px;
  }
  .eto-terms-nav {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .eto-nav-link {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #44474a;
    text-decoration: none;
    padding: 10px 16px;
    border-left: 3px solid transparent;
    transition: all 0.2s ease;
  }
  .eto-nav-link:hover {
    background: #ecf5fe;
    color: #0c1014;
  }
  .eto-nav-link.active {
    border-left-color: #c2b59b;
    background: #ecf5fe;
    color: #c2b59b;
    font-weight: 700;
  }
  .eto-terms-main {
    flex: 1;
    padding: 40px;
    background: rgba(225, 227, 228, 0.1);
  }
  .eto-terms-card {
    max-width: 1050px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 8px;
    box-shadow: 0 4px 32px rgba(0, 0, 0, 0.04);
    border: 1px solid rgba(197, 198, 202, 0.3);
    padding: 60px;
  }
  .eto-terms-header {
    margin-bottom: 50px;
  }
  .eto-terms-header h1 {
    font-family: 'Inter', sans-serif;
    font-size: 42px;
    font-weight: 700;
    color: #0c1014;
    position: relative;
    display: inline-block;
    margin-bottom: 16px;
    letter-spacing: -1px;
  }
  .eto-terms-underline {
    position: absolute;
    bottom: -4px;
    left: 0;
    width: 60px;
    height: 4px;
    background: #c2b59b;
    border-radius: 2px;
  }
  .eto-terms-date {
    font-family: 'Source Serif 4', serif;
    font-style: italic;
    color: #75777b;
    font-size: 16px;
  }
  .eto-section {
    margin-bottom: 48px;
    scroll-margin-top: 180px;
  }
  .eto-section h2 {
    font-family: 'Inter', sans-serif;
    font-size: 24px;
    font-weight: 600;
    color: #0c1014;
    margin-bottom: 20px;
  }
  .eto-p {
    font-size: 17px;
    line-height: 1.8;
    color: #333;
    margin-bottom: 20px;
  }
  .eto-ul {
    list-style-type: disc;
    padding-left: 24px;
    margin-bottom: 24px;
  }
  .eto-li {
    font-size: 17px;
    line-height: 1.8;
    color: #333;
    margin-bottom: 8px;
  }
  .eto-strong {
    font-weight: 600;
    color: #111;
  }
  @media (max-width: 991px) {
    .eto-terms-sidebar {
      display: none;
    }
    .eto-terms-main {
      padding: 20px;
    }
    .eto-terms-card {
      padding: 30px;
    }
  }
</style>
`;

const finalHtml = `
<div id="eto-brand-content" style="display: none;">
  ${customCss}
  <div class="eto-terms-container">
    ${sidebarHtml}
    ${mainHtml}
  </div>
  <script>
    function smoothScrollTo(element, duration) {
      var headerOffset = 180;
      var elementPosition = element.getBoundingClientRect().top;
      var offsetPosition = elementPosition + window.scrollY - headerOffset;
      var startPosition = window.scrollY;
      var distance = offsetPosition - startPosition;
      var startTime = null;
      
      function animation(currentTime) {
        if (startTime === null) startTime = currentTime;
        var timeElapsed = currentTime - startTime;
        var run = easeInOutCubic(timeElapsed, startPosition, distance, duration);
        window.scrollTo(0, run);
        if (timeElapsed < duration) requestAnimationFrame(animation);
      }
      
      function easeInOutCubic(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t * t + b;
        t -= 2;
        return c / 2 * (t * t * t + 2) + b;
      }
      
      requestAnimationFrame(animation);
    }
  </script>
</div>
`;

let aboutLiquid = fs.readFileSync('sections/eto-about.liquid', 'utf8');
const startIndex = aboutLiquid.indexOf('<div id="eto-brand-content" style="display: none;');
const endIndex = aboutLiquid.indexOf('<!-- Hidden Impact Rating Content -->');

if (startIndex !== -1 && endIndex !== -1) {
    const before = aboutLiquid.substring(0, startIndex);
    const after = aboutLiquid.substring(endIndex);
    fs.writeFileSync('sections/eto-about.liquid', before + finalHtml + '\n    ' + after);
    console.log("Successfully applied solid custom CSS for Stitch UI");
} else {
    console.log("Could not find markers");
}
