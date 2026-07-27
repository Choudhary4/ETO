require('dotenv').config();
const { execSync } = require('child_process');
const xml2js = require('xml2js');
const fs = require('fs');

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;

const failedSkus = [
    'MA110-A', 'UTAH', 'CRAFTSMAN 1 LITE', 'CRAFTSMAN 3 LITE',
    'EXWP1L', 'WP1L', 'FD1LSL', 'LOUVER', 'SANTA FE',
    'BAILEY', 'LA PLAYA', 'KANSAS', 'VENTURA', 'KA300V',
    'KA305V', 'ATLANTA', 'AUBURN'
];

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
    const cmd = `curl -s -X POST "${SOAP_URL}" -H "Content-Type: text/xml" -H "User-Agent: curl/8.7.1" --max-time 30 -d '${safeXml}'`;
    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
    } catch (e) {
        throw new Error('Curl command failed: ' + e.message);
    }
}

const parser = new xml2js.Parser({ explicitArray: false });
function extractValue(val) { return val && typeof val === 'object' ? val._ : val; }

async function run() {
    console.log('🔄 Checking Magento for missing SKUs using Fuzzy Search...');

    // Login
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginRaw = await curlSoap(loginXml);
    const loginResult = await parser.parseStringPromise(loginRaw);

    if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.error(`❌ API Login Error: ${loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
        return;
    }
    const sessionId = extractValue(loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn']);

    for (const sku of failedSkus) {
        console.log(`\n🔍 Searching for: ${sku}`);
        const parts = sku.split(' ');
        const searchTerm = parts[0]; // search by first word to cast a wider net

        // Filter by SKU "like"
        const args = `
            <filters>
                <filter>
                    <item>
                        <key>sku</key>
                        <value>%${searchTerm}%</value>
                    </item>
                </filter>
            </filters>
        `;

        try {
            const listXml = buildSoapEnvelope('catalogProductList', sessionId, args);
            const listRaw = await curlSoap(listXml);
            const listResult = await parser.parseStringPromise(listRaw);

            if (listResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                console.log(`   ❌ Error: ${listResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
            } else {
                const responseData = listResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductListResponse'];
                const items = responseData.storeView && responseData.storeView.item ?
                    (Array.isArray(responseData.storeView.item) ? responseData.storeView.item : [responseData.storeView.item]) : [];

                if (items.length === 0) {
                    console.log(`   🔸 Found: 0 items matching "%${searchTerm}%"`);
                } else {
                    console.log(`   ✅ Found ${items.length} items matching "%${searchTerm}%":`);
                    // Just print first 5 matches to avoid spam
                    items.slice(0, 5).forEach(item => {
                        console.log(`      - SKU: [${extractValue(item.sku)}] | Name: ${extractValue(item.name)} | ID: ${extractValue(item.product_id)}`);
                    });
                    if (items.length > 5) console.log(`      ... and ${items.length - 5} more`);
                }
            }
        } catch (e) {
            console.log(`   ⚠️ Request failed: ${e.message}`);
        }
    }

    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('\n🔒 Session Closed.');
}

run().catch(e => {
    console.error('💥 Fatal error:', e.message);
    console.error(e.stack);
});
