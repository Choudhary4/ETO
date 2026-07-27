require('dotenv').config();
const { execSync } = require('child_process');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;
const OUTPUT_FILE = path.join(__dirname, 'all_magento_products.json');

function buildSoapEnvelope(action, sessionId, args = '') {
    const sessionTag = sessionId ? `<sessionId>${sessionId}</sessionId>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:Magento">
    <SOAP-ENV:Body>
        <ns1:${action}>
            ${sessionTag}
            ${args}
        </ns1:${action}>
    </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}


async function curlSoap(xmlString) {
    const safeXml = xmlString.replace(/'/g, "'\\''");
    const cmd = `curl -s -X POST "${SOAP_URL}" -H "Content-Type: text/xml" -H "User-Agent: curl/8.7.1" --max-time 120 -d '${safeXml}'`;
    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 100 });
    } catch (e) {
        throw new Error('Curl command failed: ' + e.message);
    }
}

const parser = new xml2js.Parser({ explicitArray: false });

function extractValue(val) {
    if (!val) return val;
    return typeof val === 'object' ? val._ : val;
}

async function run() {
    console.log('🔄 Fetching ALL Magento Products (with Pagination)...');
    console.log('📡 Connecting to Magento...');

    // Login
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginRaw = await curlSoap(loginXml);
    const loginResult = await parser.parseStringPromise(loginRaw);

    if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.error(`❌ API Login Error: ${loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
        return;
    }

    const sessionId = extractValue(loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn']);
    console.log(`✅ Login Successful! Session ID: ${sessionId}`);

    let page = 1;
    let hasMore = true;

    while (hasMore) {
        console.log(`📥 Downloading catalog list Page ${page}...`);

        const listXml = buildSoapEnvelope('catalogProductList', sessionId, '');

        try {
            const safeXml = listXml.replace(/'/g, "'\\''");
            const cmd = `curl -s -X POST "${SOAP_URL}" -H "Content-Type: text/xml" -H "User-Agent: curl/8.7.1" --max-time 300 -d '${safeXml}'`;
            const listRaw = execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 });
            const listResult = await parser.parseStringPromise(listRaw);

            if (listResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                console.error(`❌ API Error: ${listResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']} `);
                hasMore = false;
            } else {
                const responseData = listResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductListResponse'];
                const items = responseData.storeView && responseData.storeView.item ?
                    (Array.isArray(responseData.storeView.item) ? responseData.storeView.item : [responseData.storeView.item]) : [];

                console.log(`✅ Downloaded ${items.length} products!`);

                const cleanCatalog = items.map(item => ({
                    product_id: parseInt(extractValue(item.product_id) || 0),
                    sku: extractValue(item.sku),
                    name: extractValue(item.name),
                    type: extractValue(item.type),
                    set: extractValue(item.set)
                }));

                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cleanCatalog, null, 2));
                console.log(`💾 Saved to all_magento_products.json`);
                hasMore = false;
            }
        } catch (e) {
            console.error(`❌ Error fetching large catalog: ${e.message} `);
            hasMore = false;
        }
    }

    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('🔒 Session Closed.');
}

run().catch(e => {
    console.error('💥 Fatal error:', e.message);
    console.error(e.stack);
});
