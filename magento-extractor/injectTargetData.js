const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SHOPIFY_URL = 'etodoorscorp.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

if (!SHOPIFY_ACCESS_TOKEN) {
    console.error('❌ Error: SHOPIFY_ACCESS_TOKEN is missing in .env file.');
    process.exit(1);
}

const API_VERSION = '2024-01';
const GRAPHQL_ENDPOINT = `https://${SHOPIFY_URL}/admin/api/${API_VERSION}/graphql.json`;

const OPTIONS_FILE = 'shopify_ready_options.json';
const TABS_FILE = 'magento_tabs_data.json';
const CSV_FILE = '/Users/saurabhkuntal/Downloads/Zoho Books Items - Shopify (1) (1)(in) (3).csv';

// Load local files safely
let optionsData = {};
if (fs.existsSync(OPTIONS_FILE)) {
    optionsData = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
}

let tabsData = {};
if (fs.existsSync(TABS_FILE)) {
    tabsData = JSON.parse(fs.readFileSync(TABS_FILE, 'utf8'));
}

async function shopifyGraphQL(query, variables = {}) {
    const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });
    const result = await response.json();
    if (result.errors) {
        throw new Error(JSON.stringify(result.errors, null, 2));
    }

    // basic rate limit mitigation
    const cost = result.extensions && result.extensions.cost;
    if (cost && cost.throttleStatus && cost.throttleStatus.currentlyAvailable < 200) {
        await new Promise(r => setTimeout(r, 2000));
    }

    return result.data;
}

// 1. Find Product ID by Handle/SKU
async function getProductIdByHandle(handle) {
    const formattedHandle = handle.toLowerCase().replace(/\\s+/g, '-');
    const query = `
        query getProduct($handle: String!) {
            productByHandle(handle: $handle) {
                id
            }
        }
    `;
    const data = await shopifyGraphQL(query, { handle: formattedHandle });
    return data && data.productByHandle ? data.productByHandle.id : null;
}

// 2. Set Multiple Metafields on Product
async function setProductMetafields(productId, sku) {
    const metafields = [];

    // A: Door Options Metafield
    if (optionsData[sku] && optionsData[sku].length > 0) {
        metafields.push({
            ownerId: productId,
            namespace: "custom",
            key: "door_options",
            type: "json",
            value: JSON.stringify(optionsData[sku])
        });
    }

    // B: Overview Metafield
    if (tabsData[sku] && tabsData[sku].overview) {
        metafields.push({
            ownerId: productId,
            namespace: "custom",
            key: "overview",
            type: "multi_line_text_field", // or rich_text_field depending on setup
            value: String(tabsData[sku].overview).substring(0, 10000) // basic safety crop
        });
    }

    // C: Specification Metafield
    if (tabsData[sku] && tabsData[sku].specification) {
        metafields.push({
            ownerId: productId,
            namespace: "custom",
            key: "specification",
            // Assuming HTML needs to go into a rich_text or multi_line.
            // If the user setup Rich text, this will fail if it's not strictly formatted JSON AST. 
            // Usually, users set it as `multi_line_text_field` to dump HTML.
            type: "multi_line_text_field",
            value: String(tabsData[sku].specification).substring(0, 10000)
        });
    }

    // D: Lead Time Metafield
    if (tabsData[sku] && tabsData[sku].lead_time) {
        metafields.push({
            ownerId: productId,
            namespace: "custom",
            key: "lead_time",
            type: "multi_line_text_field",
            value: String(tabsData[sku].lead_time).substring(0, 10000)
        });
    }

    if (metafields.length === 0) {
        return { skipped: true };
    }

    const mutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
                metafields {
                    id
                    key
                }
                userErrors {
                    field
                    message
                }
            }
        }
    `;
    const variables = { metafields };

    const data = await shopifyGraphQL(mutation, variables);
    if (data.metafieldsSet.userErrors && data.metafieldsSet.userErrors.length > 0) {
        console.error(`💥 Metafield Error on ${sku}:`, JSON.stringify(data.metafieldsSet.userErrors, null, 2));
        throw new Error('Metafield Set failed due to user errors.');
    }
    return { success: true, count: data.metafieldsSet.metafields.length };
}

async function getUniqueSkus() {
    return new Promise((resolve, reject) => {
        const skus = new Set();
        fs.createReadStream(CSV_FILE)
            .pipe(csv())
            .on('data', (row) => {
                if (row['Handle']) {
                    skus.add(row['Handle'].toUpperCase().trim());
                }
            })
            .on('end', () => {
                resolve(Array.from(skus));
            })
            .on('error', reject);
    });
}

async function runInjection() {
    console.log('🚀 Starting Unified Shopify Metafield Injection (Options & Tabs)...');

    const targetSkus = await getUniqueSkus();
    console.log(`📋 Found ${targetSkus.length} unique handles in recent CSV.`);

    let successCount = 0;
    let notFoundCount = 0;
    let skipCount = 0;

    for (let i = 0; i < targetSkus.length; i++) {
        const sku = targetSkus[i];

        console.log(`[${i + 1}/${targetSkus.length}] Processing Data for: ${sku}`);

        try {
            const productId = await getProductIdByHandle(sku);
            if (!productId) {
                console.log(`   ⚠️ Product not found in Shopify... skipping.`);
                notFoundCount++;
                continue;
            }

            const result = await setProductMetafields(productId, sku);

            if (result.skipped) {
                console.log(`   ⏭️ Skipped (No Options or Tabs data available locally).`);
                skipCount++;
            } else {
                console.log(`   ✅ Injected ${result.count} Metafields for ${sku}.`);
                successCount++;
            }

            // Sleep slightly to avoid API rate limits
            await new Promise(res => setTimeout(res, 600));

        } catch (e) {
            console.error(`   ❌ Failed to inject ${sku}. Exception message: ${e.message}`);
        }
    }

    console.log(`\n🎉 Unified Injection Complete!`);
    console.log(`✅ Success: ${successCount} products updated`);
    console.log(`⏭️ Ignored: ${skipCount} products missing local mapping data`);
    console.log(`⚠️ Not Found in store: ${notFoundCount} products`);
}

runInjection();
