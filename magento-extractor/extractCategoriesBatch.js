require('dotenv').config();
const { exec } = require('child_process');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;

const ALL_PRODUCTS_FILE = path.join(__dirname, 'all_magento_products.json');
const OPTIONS_FILE = path.join(__dirname, 'shopify_ready_options.json');
const OUTPUT_FILE = path.join(__dirname, 'magento_categories_data.json');

const allProducts = fs.existsSync(ALL_PRODUCTS_FILE) ? JSON.parse(fs.readFileSync(ALL_PRODUCTS_FILE, 'utf8')) : [];
const mainSkusData = fs.existsSync(OPTIONS_FILE) ? JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8')) : {};
const mainSkus = Object.keys(mainSkusData);

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
        const { stdout } = await execAsync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
        return stdout;
    } catch (e) {
        throw new Error('Curl command failed: ' + e.message);
    }
}

const parser = new xml2js.Parser({ explicitArray: false });
function extractValue(val) { return val && typeof val === 'object' ? val._ : val; }

function flattenCategoryTree(node, map = {}) {
    if (!node) return map;
    const catId = extractValue(node.category_id);
    const catName = extractValue(node.name);
    if (catId && catName) { map[catId] = catName; }
    if (node.children && node.children.item) {
        const children = Array.isArray(node.children.item) ? node.children.item : [node.children.item];
        for (const child of children) flattenCategoryTree(child, map);
    }
    return map;
}

// Global state
let sessionId;
let categoryMap = {};
let skuToIdMap = {};

async function fetchCategoryForSku(sku, index) {
    const identifier = skuToIdMap[sku] ? skuToIdMap[sku] : sku;
    const idTypeFrag = skuToIdMap[sku] ? '' : '<identifierType>sku</identifierType>';

    const args = `
        <productId>${identifier}</productId>
        <storeView></storeView>
        <attributes>
            <item>category_ids</item>
        </attributes>
        ${idTypeFrag}
    `;

    try {
        const infoXml = buildSoapEnvelope('catalogProductInfo', sessionId, args);
        const infoRaw = await curlSoap(infoXml);
        const infoResult = await parser.parseStringPromise(infoRaw);

        if (infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
            console.log(`   ❌ [${index + 1}/${mainSkus.length}] Failed [${sku}]: ${infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
            return { sku, data: { error: 'Product does not exist or fetch failed' } };
        } else {
            const info = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse'] ? infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse']['info'] : null;

            if (info && info.category_ids) {
                let catIdsNodes = info.category_ids.item ? info.category_ids.item : info.category_ids;
                if (!Array.isArray(catIdsNodes)) catIdsNodes = [catIdsNodes];

                let assignedIds = catIdsNodes.map(node => extractValue(node)).filter(Boolean);
                let assignedNames = assignedIds.map(id => categoryMap[id] || `Unknown Category (${id})`);

                console.log(`   ✅ [${index + 1}/${mainSkus.length}] ${sku} -> ${assignedNames.length} categories.`);
                return { sku, data: { category_ids: assignedIds, category_names: assignedNames } };
            } else {
                console.log(`   ⚠️ [${index + 1}/${mainSkus.length}] ${sku} -> No associated categories.`);
                return { sku, data: { category_ids: [], category_names: [] } };
            }
        }
    } catch (e) {
        console.log(`   ⚠️ Error [${sku}]: ${e.message}`);
        return { sku, data: { error: e.message } };
    }
}

async function run() {
    console.log(`🔄 Extracting Category Data for ${mainSkus.length} main SKUs (CONCURRENT BATCH)...`);

    // Login
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginRaw = await curlSoap(loginXml);
    const loginResult = await parser.parseStringPromise(loginRaw);

    if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.error(`❌ API Login Error: ${loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
        return;
    }
    sessionId = extractValue(loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn']);
    console.log(`✅ Logged in successfully!`);

    // 1. Fetch Category Tree
    console.log('📥 Fetching Category Tree...');
    const treeXml = buildSoapEnvelope('catalogCategoryTree', sessionId, `<parentId>1</parentId>`);
    const treeRaw = await curlSoap(treeXml);
    const treeResult = await parser.parseStringPromise(treeRaw);

    if (treeResult && treeResult['SOAP-ENV:Envelope'] && treeResult['SOAP-ENV:Envelope']['SOAP-ENV:Body'] && treeResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogCategoryTreeResponse']) {
        const treeData = treeResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogCategoryTreeResponse']['tree'];
        categoryMap = flattenCategoryTree(treeData);
        console.log(`✅ Loaded ${Object.keys(categoryMap).length} categories.`);
    }

    for (const p of allProducts) {
        if (p.sku && p.product_id) { skuToIdMap[p.sku] = p.product_id; }
    }

    const categoriesResult = {};
    const concurrency = 10;

    console.log(`\n🔍 Fetching product details (${concurrency} at a time)...`);

    for (let i = 0; i < mainSkus.length; i += concurrency) {
        const batch = mainSkus.slice(i, i + concurrency);

        // Ensure new session per batch if needed, or just reuse. Magento supports concurrent calls on same session ID.
        const promises = batch.map((sku, idx) => fetchCategoryForSku(sku, i + idx));

        const results = await Promise.all(promises);

        for (const res of results) {
            categoriesResult[res.sku] = res.data;
        }

        // Wait 1 second between batches to not overload server
        await new Promise(r => setTimeout(r, 1000));
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(categoriesResult, null, 2));
    console.log(`\n💾 Saved category data to magento_categories_data.json`);

    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('🔒 Session Closed.');
}

run().catch(console.error);
