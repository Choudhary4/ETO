require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MAGENTO_ADMIN_URL = 'https://www.etodoors.com/index.php/etoteam/';
const ADMIN_USER = process.env.MAGENTO_ADMIN_USER;
const ADMIN_PASS = process.env.MAGENTO_ADMIN_PASS;
const OUTPUT_FILE = './magento_option_images.json';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    console.log('🚀 Starting Magento Admin Puppeteer Extraction...');

    if (!ADMIN_USER || !ADMIN_PASS) {
        console.error('❌ Missing Admin Credentials in .env');
        return;
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Go to Admin Login page
        console.log('🌐 Loading Admin login page...');
        await page.goto(MAGENTO_ADMIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(5000); // Wait for Cloudflare potentially

        let title = await page.title();
        if (title.includes('Just a moment')) {
            console.log('⏳ Cloudflare challenge, waiting 20s...');
            await delay(20000);
        }

        console.log('🔑 Logging in...');
        // Fill login form
        // Checking for standard Magento 1 admin inputs
        await page.type('#username', ADMIN_USER);
        await page.type('#login', ADMIN_PASS);
        
        // Click login button
        await page.click('.form-button');
        
        console.log('⏳ Waiting for dashboard to load...');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        
        console.log('✅ Logged in to Admin panel');

        // Navigating to the Custom Options Manager (Catalog -> Custom Options)
        // Adjust URL according to the extension used for options, or navigate to a sample product
        const targetUrl = 'https://etodoors.com/index.php/etoteam/catalog_product/edit/id/2039/key/'; // Based on screenshot
        console.log('🌐 Navigating to Target Product Options page (based on screenshot URL structure)...');
        
        // Since we don't have the exact key, we might need to go to Catalog > Manage Products, search for a configurable product and click it. Let's try to find the option templates page first if they use MageWorx or similar.
        // Let's go to Manage Products -> first product with options.
        
        await page.goto(MAGENTO_ADMIN_URL + 'catalog_product/', { waitUntil: 'networkidle2', timeout: 30000 });
        console.log('🌐 On products grid, applying filter for ID 2039...');
        
        // Try filling ID filter
        try {
            await page.type('input[name="product[entity_id]"]', '2039');
            await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (let b of buttons) {
                    if (b.innerText.includes('Search')) b.click();
                }
            });
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
        } catch(e) { console.log('Could not use search filter directly.')}

        console.log('🖱️ Clicking on product row...');
        // Click the first row (excluding header)
        try {
            await page.click('#productGrid_table tbody tr:first-child');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
        } catch(e) {
            console.log('Nav failed.');
        }

        // Wait to load the product edit page
        await delay(5000);
        
        console.log('��️ Clicking Custom Options tab...');
        // Click the Custom Options tab on the left sidebar
        await page.evaluate(() => {
            const tabs = document.querySelectorAll('.tab-item-link span');
            for (let t of tabs) {
                 if (t.innerText.includes('Custom Options')) t.click();
            }
        });
        await delay(5000); // Wait for AJAX load

        console.log('🔍 Executing Extraction Script on page...');
        const extractedData = await page.evaluate(() => {
            let optionsData = [];
            
            // Typical Magento Option Blocks
            const optionBlocks = document.querySelectorAll('.option-box');
            
            optionBlocks.forEach(block => {
                const titleInput = block.querySelector('input[name*="[title]"]');
                if (!titleInput) return;
                const optionTitle = titleInput.value;
                
                let values = [];
                const valueRows = block.querySelectorAll('tr[id^="product_option_"]');
                
                valueRows.forEach(row => {
                    const valueTitleInput = row.querySelector('input[name*="[title]"]');
                    const priceInput = row.querySelector('input[name*="[price]"]');
                    
                    // Search for Image previews
                    const imgElement = row.querySelector('img');
                    
                    if (valueTitleInput && valueTitleInput.value) {
                        values.push({
                            title: valueTitleInput.value,
                            price: priceInput ? priceInput.value : '0',
                            imageUrl: imgElement ? imgElement.src : null
                        });
                    }
                });
                
                if (values.length > 0) {
                    optionsData.push({
                        optionTitle: optionTitle,
                        values: values
                    });
                }
            });
            return optionsData;
        });

        console.log(`✅ Extracted data for ${extractedData.length} options`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(extractedData, null, 2));
        console.log(`💾 Saved to ${OUTPUT_FILE}`);

    } catch (e) {
        console.error('🔥 Error:', e.message);
        // Take a screenshot of the failure
        await browser.pages().then(pages => pages[0].screenshot({path: 'magento_admin_error.png'})).catch(e=>e);
        console.log('📸 Saved error screenshot to magento_admin_error.png');
    } finally {
        await browser.close();
        console.log('🏁 Browser closed.');
    }
}
run();
