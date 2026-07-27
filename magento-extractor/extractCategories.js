require('dotenv').config();
const { execSync } = require('child_process');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;

// We use the already downloaded products to get the IDs for our main SKUs
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
    const cmd = `curl -s -X POST "${SOAP_URL}" -H "Content-Type: text/xml" -H "User-Agent: curl/8.7.1" --max-time 120 -d '${safeXml}'`;
    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
    } catch (e) {
        throw new Error('Curl command failed: ' + e.message);
    }
}

const parser = new xml2js.Parser({ explicitArray: false });
function extractValue(val) { return val && typeof val === 'object' ? val._ : val; }

// Recursively build a flat dictionary of CategoryID -> CategoryName
function flattenCategoryTree(node, map = {}) {
    if (!node) return map;

    const catId = extractValue(node.category_id);
    const catName = extractValue(node.name);

    if (catId && catName) {
        map[catId] = catName;
    }

    // Check children
    if (node.children && node.children.item) {
        const children = Array.isArray(node.children.item) ? node.children.item : [node.children.item];
        for (const child of children) {
            flattenCategoryTree(child, map);
        }
    }
    return map;
}

async function run() {
    console.log(`🔄 Extracting Category Data for ${mainSkus.length} main SKUs...`);
    console.log('📡 Connecting to Magento API...');

    // Login
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginRaw = await curlSoap(loginXml);
    const loginResult = await parser.parseStringPromise(loginRaw);

    if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.error(`❌ API Login Error: ${loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
        return;
    }
    const sessionId = extractValue(loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn']);
    console.log(`✅ Logged in successfully!`);

    // 1. Fetch entire Category Tree (to map IDs to Names)
    console.log('📥 Fetching Category Tree...');
    const treeXml = buildSoapEnvelope('catalogCategoryTree', sessionId, `<parentId>1</parentId>`);
    const treeRaw = await curlSoap(treeXml);
    const treeResult = await parser.parseStringPromise(treeRaw);

    let categoryMap = {};
    if (treeResult && treeResult['SOAP-ENV:Envelope'] && treeResult['SOAP-ENV:Envelope']['SOAP-ENV:Body'] && treeResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogCategoryTreeResponse']) {
        const treeData = treeResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogCategoryTreeResponse']['tree'];
        categoryMap = flattenCategoryTree(treeData);
        console.log(`✅ Loaded ${Object.keys(categoryMap).length} categories from tree mapping.`);
    } else {
        console.log('⚠️ Failed to load category tree. Categories will be IDs only.');
    }

    // 2. Map main SKUs to Magento Product IDs (for faster info lookup)
    const skuToIdMap = {};
    for (const p of allProducts) {
        if (p.sku && p.product_id) {
            skuToIdMap[p.sku] = p.product_id;
        }
    }

    const categoriesResult = {};
    let successCount = 0;
    let failCount = 0;

    // 3. Fetch product info for each SKU to get its category_ids
    console.log(`\n🔍 Fetching product details to extract categories...`);

    for (let i = 0; i < mainSkus.length; i++) {
        const sku = mainSkus[i];

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
                console.log(`   ❌ Failed [${sku}]: ${infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
                categoriesResult[sku] = { error: 'Product does not exist or fetch failed' };
                failCount++;
            } else {
                const info = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse'] ? infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse']['info'] : null;

                if (info && info.category_ids) {
                    let catIdsNodes = info.category_ids.item ? info.category_ids.item : info.category_ids;
                    if (!Array.isArray(catIdsNodes)) catIdsNodes = [catIdsNodes];

                    let assignedIds = catIdsNodes.map(node => extractValue(node)).filter(Boolean);
                    let assignedNames = assignedIds.map(id => categoryMap[id] || `Unknown Category (${id})`);

                    categoriesResult[sku] = {
                        category_ids: assignedIds,
                        category_names: assignedNames
                    };

                    console.log(`   ✅ [${i + 1}/${mainSkus.length}] ${sku} -> ${assignedNames.length} categories found.`);
                    successCount++;
                } else {
                    console.log(`   ⚠️ [${i + 1}/${mainSkus.length}] ${sku} -> No associated categories.`);
                    categoriesResult[sku] = { category_ids: [], category_names: [] };
                    successCount++;
                }
            }
        } catch (e) {
            console.log(`   ⚠️ Error [${sku}]: ${e.message}`);
            categoriesResult[sku] = { error: e.message };
            failCount++;
        }
    }

    // Save results
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(categoriesResult, null, 2));
    console.log(`\n💾 Saved category data to magento_categories_data.json`);
    console.log(`📊 Total: ${mainSkus.length} | Success: ${successCount} | Failed: ${failCount}`);

    // Logout
    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('🔒 Session Closed.');
}

run().catch(console.error);
