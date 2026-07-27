require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function soapFetch(page, url, xml) {
    return page.evaluate(async (u, x) => {
        try {
            const r = await fetch(u, {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml; charset=utf-8' },
                body: x,
                credentials: 'include'
            });
            return { status: r.status, data: await r.text() };
        } catch (e) {
            return { error: e.message };
        }
    }, url, xml);
}

async function run() {
    console.log('🚀 Puppeteer Extraction v5 - Final Attempt');

    if (!API_USER || !API_KEY) {
        console.error('❌ Missing .env credentials');
        return;
    }

    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720',
            '--disable-infobars'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = { runtime: {} };
        });

        // Step 1: Load homepage (pass Cloudflare for main domain)
        console.log('🌐 Step 1: Loading homepage...');
        await page.goto(MAGENTO_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(10000);

        let title = await page.title();
        if (title.includes('Just a moment')) {
            await delay(20000);
            title = await page.title();
        }
        console.log(`📄 Homepage: "${title}"`);
        if (title.includes('Just a moment')) { console.error('❌ Cannot pass challenge'); return; }

        // Step 2: Visit /api/ path to trigger and solve its separate challenge
        console.log('\n🌐 Step 2: Visiting /api/ path to solve its challenge...');
        await page.goto(SOAP_URL, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => { });
        await delay(5000);
        title = await page.title();
        console.log(`📄 API page: "${title}"`);

        if (title.includes('Just a moment') || title.includes('security')) {
            console.log('⏳ Cloudflare challenge on /api/... waiting 25s...');
            await delay(25000);
            title = await page.title();
            console.log(`📄 After wait: "${title}"`);

            if (title.includes('Just a moment')) {
                console.log('⏳ Still solving... waiting 30s more...');
                await delay(30000);
                title = await page.title();
                console.log(`📄 After 2nd wait: "${title}"`);
            }
        }

        // Check what we got after the challenge timeout
        const apiBody = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 300) : '');
        console.log(`📄 API body: "${apiBody.substring(0, 150)}"`);

        // Get all cookies after both pages visited
        const cookies = await page.cookies();
        console.log(`🍪 Cookies: ${cookies.length}`);
        cookies.forEach(c => console.log(`   - ${c.name}: ${c.value.substring(0, 30)}...`));

        // Step 3: Now go back to homepage (fully loaded page) to make XHR from there
        console.log('\n🌐 Step 3: Going back to homepage...');
        await page.goto(MAGENTO_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        await delay(5000);
        title = await page.title();
        console.log(`📄 Back on homepage: "${title}"`);

        // Step 4: Try SOAP Login from homepage via fetch
        console.log('\n🔑 Step 4: SOAP Login via fetch from homepage...');

        const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:Magento">
    <SOAP-ENV:Body>
        <ns1:login>
            <username>${API_USER}</username>
            <apiKey>${API_KEY}</apiKey>
        </ns1:login>
    </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

        const loginResult = await soapFetch(page, SOAP_URL, loginXml);
        console.log(`� Login status: ${loginResult.status || loginResult.error}`);

        if (loginResult.error) {
            console.error(`❌ Fetch error: ${loginResult.error}`);
            console.log('\n🔄 Falling back to form-submit approach...');

            // Final fallback: Submit a form to the SOAP URL
            const formResult = await page.evaluate(async (url, xml) => {
                return new Promise((resolve) => {
                    const iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.name = 'soapFrame';
                    document.body.appendChild(iframe);

                    const form = document.createElement('form');
                    form.method = 'POST';
                    form.action = url;
                    form.target = 'soapFrame';
                    form.enctype = 'text/plain';

                    const input = document.createElement('textarea');
                    input.name = 'data';
                    input.value = xml;
                    form.appendChild(input);

                    document.body.appendChild(form);

                    iframe.onload = () => {
                        try {
                            resolve({ data: iframe.contentDocument.body.innerText, ok: true });
                        } catch (e) {
                            resolve({ error: 'Cannot read iframe: ' + e.message, ok: false });
                        }
                    };

                    form.submit();
                    setTimeout(() => resolve({ error: 'timeout', ok: false }), 15000);
                });
            }, SOAP_URL, loginXml);

            console.log(`📬 Form result: ${JSON.stringify(formResult).substring(0, 500)}`);

            if (!formResult.ok) {
                console.log('\n❌ All methods failed. Need Cloudflare or cPanel credentials.');
                return;
            }
        }

        if (loginResult.status === 403) {
            console.error('❌ Still 403. Cloudflare is blocking API access.');
            return;
        }

        if (loginResult.status === 502) {
            console.error('❌ 502 Bad Gateway - Magento origin server is not responding to SOAP.');
            console.log('This might mean the SOAP API endpoint is not active or misconfigured.');
            console.log('Raw:', loginResult.data.substring(0, 200));
            return;
        }

        if (loginResult.status !== 200) {
            console.error(`❌ Unexpected status: ${loginResult.status}`);
            console.log('Data:', loginResult.data ? loginResult.data.substring(0, 300) : 'empty');
            return;
        }

        // Parse session ID
        const sessionMatch = loginResult.data.match(/<loginReturn[^>]*>(.*?)<\/loginReturn>/);
        if (!sessionMatch) {
            const faultMatch = loginResult.data.match(/<faultstring>(.*?)<\/faultstring>/);
            console.error(faultMatch ? `❌ SOAP Fault: ${faultMatch[1]}` : '❌ Cannot parse session');
            console.log('Raw:', loginResult.data.substring(0, 500));
            return;
        }

        const sid = sessionMatch[1];
        console.log(`\n✅✅✅ LOGIN SUCCESS! Session: ${sid}`);

        // Fetch product
        const testSku = 'HADLEY';
        console.log(`\n🔍 Product info: ${testSku}`);
        const infoXml = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:Magento"><SOAP-ENV:Body><ns1:catalogProductInfo><sessionId>${sid}</sessionId><productId>${testSku}</productId><identifierType>sku</identifierType></ns1:catalogProductInfo></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
        const infoR = await soapFetch(page, SOAP_URL, infoXml);
        const nameM = infoR.data ? infoR.data.match(/<name>(.*?)<\/name>/) : null;
        if (nameM) console.log(`✅ Product: ${nameM[1]}`);
        else console.log('⚠️ Product fetch:', infoR.status || infoR.error);

        // Fetch options
        console.log(`\n🔍 Custom Options: ${testSku}`);
        const optXml = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:Magento"><SOAP-ENV:Body><ns1:catalogProductCustomOptionList><sessionId>${sid}</sessionId><productId>${testSku}</productId><store></store></ns1:catalogProductCustomOptionList></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
        const optR = await soapFetch(page, SOAP_URL, optXml);
        if (optR.data) {
            fs.writeFileSync('raw_options_response.xml', optR.data, 'utf8');
            console.log('💾 Saved raw_options_response.xml');
            console.log('\n📋 Preview:\n' + optR.data.substring(0, 2000));
        }

        // End session
        const endXml = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:Magento"><SOAP-ENV:Body><ns1:endSession><sessionId>${sid}</sessionId></ns1:endSession></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
        await soapFetch(page, SOAP_URL, endXml);
        console.log('\n🔒 Session closed.');
        console.log('🎉 DONE!');

    } catch (e) {
        console.error('🔥', e.message);
    } finally {
        await browser.close();
        console.log('🏁 Browser closed.');
    }
}

run();
