require('dotenv').config();
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;
const OUTPUT_FILE = path.join(__dirname, 'magento_category_descriptions.json');

const parser = new xml2js.Parser({ explicitArray: false });

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
    const { stdout } = await execAsync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
    return stdout;
}

function extractValue(val) { return val && typeof val === 'object' ? val._ : val; }

function flattenCategoryTree(node, map = {}) {
    if (!node) return map;
    const catId = extractValue(node.category_id);
    const catName = extractValue(node.name);
    if (catId && catName) { map[catId] = catName; }
    if (node.children && node.children.item) {
        const children = Array.isArray(node.children.item) ? node.children.item : [node.children.item];
        for (const child of children) { flattenCategoryTree(child, map); }
    }
    return map;
}

async function run() {
    console.log('📡 Connecting to Magento API...');
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginRaw = await curlSoap(loginXml);
    const loginResult = await parser.parseStringPromise(loginRaw);
    
    if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.error(`❌ API Login Error:`, loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']);
        return;
    }
    const sessionId = extractValue(loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn']);
    console.log(`✅ Logged in successfully!`);

    console.log('📥 Fetching Category Tree...');
    const treeXml = buildSoapEnvelope('catalogCategoryTree', sessionId, `<parentId>1</parentId>`);
    const treeRaw = await curlSoap(treeXml);
    const treeResult = await parser.parseStringPromise(treeRaw);

    const treeData = treeResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogCategoryTreeResponse']['tree'];
    const categoryMap = flattenCategoryTree(treeData);
    const categoryIds = Object.keys(categoryMap);
    console.log(`✅ Loaded ${categoryIds.length} categories.`);

    const categoryDetails = {};
    console.log('🔍 Fetching descriptions for all categories...');

    const chunkArray = (arr, size) => {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    };

    const chunks = chunkArray(categoryIds, 10);
    let processed = 0;

    for (const chunk of chunks) {
        await Promise.all(chunk.map(async (catId) => {
            const catName = categoryMap[catId];
            const args = `<categoryId>${catId}</categoryId><storeView></storeView><attributes><item>description</item><item>meta_description</item></attributes>`;
            
            try {
                const infoXml = buildSoapEnvelope('catalogCategoryInfo', sessionId, args);
                const infoRaw = await curlSoap(infoXml);
                const infoResult = await parser.parseStringPromise(infoRaw);
                const info = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogCategoryInfoResponse']['info'];

                const desc = extractValue(info.description);
                const metaDesc = extractValue(info.meta_description);

                categoryDetails[catName] = {
                    id: catId,
                    name: catName,
                    description: desc || null,
                    meta_description: metaDesc || null
                };
                processed++;
                console.log(`   [${processed}/${categoryIds.length}] ${catName}: ${desc ? '✅ Desc' : '❌ No Desc'} ${metaDesc ? '✅ Meta' : '❌ No Meta'}`);
            } catch(e) {
                processed++;
                console.log(`   ⚠️ Failed for ${catName} (${catId})`);
            }
        }));
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(categoryDetails, null, 2));
    console.log(`\n💾 Saved data to ${OUTPUT_FILE}`);

    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('🔒 Session Closed.');
}

run().catch(console.error);
