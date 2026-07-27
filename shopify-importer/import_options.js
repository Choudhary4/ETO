require('dotenv').config();
const fs = require('fs');
const axios = require('axios');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const OPTIONS_FILE = '../magento-extractor/magento_options.json';

const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;
const delay = ms => new Promise(res => setTimeout(res, ms));

async function getProductIdByHandle(handle) {
    const formattedHandle = handle.toLowerCase().replace(/\\s+/g, '-');
    const query = `
        query getProduct($handle: String!) {
            productByHandle(handle: $handle) {
                id
            }
        }
    `;
    try {
        const response = await axios.post(
            GRAPHQL_URL,
            { query, variables: { handle: formattedHandle } },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );
        return response.data.data.productByHandle ? response.data.data.productByHandle.id : null;
    } catch (e) {
        console.error(`Error querying Product Info for ${handle}:`, e.message);
        return null;
    }
}

async function setProductOptions(productId, sku, optionsData) {
    if (!optionsData || optionsData.length === 0) return { skipped: true };

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

    // Store as JSON type metafield mapping to custom.door_options
    const variables = {
        metafields: [
            {
                ownerId: productId,
                namespace: "custom",
                key: "door_options",
                type: "json",
                value: JSON.stringify(optionsData)
            }
        ]
    };

    const response = await axios.post(
        GRAPHQL_URL,
        { query: mutation, variables },
        { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );

    const data = response.data.data;
    if (data.metafieldsSet.userErrors && data.metafieldsSet.userErrors.length > 0) {
        console.error(`💥 Metafield Error on ${sku}:`, JSON.stringify(data.metafieldsSet.userErrors, null, 2));
        throw new Error('Metafield Set failed due to user errors.');
    }
    return { success: true };
}

async function runInjection() {
    console.log('🚀 Starting Shopify Metafield Injection for Options...');

    let optionsJSON = {};
    if (fs.existsSync(OPTIONS_FILE)) {
        optionsJSON = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
    } else {
        console.error(`❌ options file not found at ${OPTIONS_FILE}`);
        return;
    }

    const skus = Object.keys(optionsJSON);
    console.log(`📋 Found ${skus.length} unique items in ${OPTIONS_FILE}.`);

    let successCount = 0;
    let notFoundCount = 0;

    for (let i = 0; i < skus.length; i++) {
        const sku = skus[i];
        console.log(`[${i + 1}/${skus.length}] Processing Data for: ${sku}`);

        const productId = await getProductIdByHandle(sku);
        if (!productId) {
            console.log(`   ⚠️ Product not found in Shopify... skipping.`);
            notFoundCount++;
            continue;
        }

        try {
            const result = await setProductOptions(productId, sku, optionsJSON[sku]);
            if (!result.skipped) {
                console.log(`   ✅ Injected Options Metafield for ${sku}.`);
                successCount++;
            }
        } catch (e) {
            console.error(`   ❌ Failed to inject ${sku}. Exception message: ${e.message}`);
        }

        await delay(500); // 500ms between requests to avoid Leaky Bucket throttle
    }

    console.log(`\n🎉 Options Injection Complete!`);
    console.log(`✅ Success: ${successCount} products updated`);
    console.log(`⚠️ Not Found in store: ${notFoundCount} products`);
}

runInjection();
