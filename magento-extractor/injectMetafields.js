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

const data = JSON.parse(fs.readFileSync('shopify_ready_options.json', 'utf8'));
const CSV_FILE = '/Users/saurabhkuntal/Downloads/Zoho Books Items - Shopify (1) (1)(in) (3).csv';

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
    return result.data;
}

// 1. Find Product ID by Handle/SKU
async function getProductIdByHandle(handle) {
    // We assume the handle in shopify matches the SKU from Magento (lowercased/hyphenated)
    const formattedHandle = handle.toLowerCase().replace(/\s+/g, '-');
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

// 2. Set Metafield on Product
async function setProductMetafield(productId, namespace, key, jsonString) {
    const mutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
                metafields {
                    id
                    key
                    value
                }
                userErrors {
                    field
                    message
                }
            }
        }
    `;
    const variables = {
        metafields: [
            {
                ownerId: productId,
                namespace: namespace,
                key: key,
                type: "json",
                value: jsonString
            }
        ]
    };

    const data = await shopifyGraphQL(mutation, variables);
    if (data.metafieldsSet.userErrors && data.metafieldsSet.userErrors.length > 0) {
        throw new Error(JSON.stringify(data.metafieldsSet.userErrors, null, 2));
    }
    return data.metafieldsSet.metafields[0];
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
    console.log('🚀 Starting Targetted Shopify Metafield Injection...');

    const targetSkus = await getUniqueSkus();
    console.log(`📋 Found ${targetSkus.length} unique handles in recent CSV.`);

    let successCount = 0;
    let notFoundCount = 0;
    let missingDataCount = 0;

    for (let i = 0; i < targetSkus.length; i++) {
        const sku = targetSkus[i];

        if (!data[sku] || data[sku].length === 0) {
            console.log(`   ⏭️ Skipped ${sku}: No options found in shopify_ready_options.json`);
            missingDataCount++;
            continue;
        }

        const optionsJson = JSON.stringify(data[sku]);

        console.log(`[${i + 1}/${targetSkus.length}] Processing Options for SKU: ${sku}`);

        try {
            const productId = await getProductIdByHandle(sku);
            if (!productId) {
                console.log(`   ⚠️ Product not found on Shopify for handle/sku: ${sku}`);
                notFoundCount++;
                continue;
            }

            await setProductMetafield(productId, 'custom', 'door_options', optionsJson);
            console.log(`   ✅ Successfully injected options metafields for ${sku}`);
            successCount++;

            // Sleep slightly to avoid API rate limits
            await new Promise(res => setTimeout(res, 500));

        } catch (e) {
            console.error(`   ❌ Error injecting ${sku}:`, e.message);
        }
    }

    console.log(`\n🎉 Injection Complete!`);
    console.log(`✅ Success: ${successCount} products updated`);
    console.log(`⚠️ Skipped (No Data): ${missingDataCount} products skipped`);
    console.log(`⚠️ Not Found in store: ${notFoundCount} products skipped`);
}

runInjection();
