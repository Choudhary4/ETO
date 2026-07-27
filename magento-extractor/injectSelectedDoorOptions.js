const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SHOPIFY_URL = 'etodoorscorp.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';
const GRAPHQL_ENDPOINT = `https://${SHOPIFY_URL}/admin/api/${API_VERSION}/graphql.json`;

if (!SHOPIFY_ACCESS_TOKEN) {
    console.error('❌ Error: SHOPIFY_ACCESS_TOKEN is missing in .env file.');
    process.exit(1);
}

const OPTIONS_FILE = path.join(__dirname, 'custom_door_options_raw_format.json');
const optionsData = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
const targetSkus = ['LOUVER', 'RITZ', 'RANCHO', 'LA PLAYA'];

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

async function getProductIdByHandle(handle) {
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

async function setProductMetafield(productId, namespace, key, jsonString) {
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
    const variables = {
        metafields: [
            {
                ownerId: productId,
                namespace,
                key,
                type: 'json',
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

async function run() {
    console.log('🚀 Injecting selected door option metafields into Shopify...');

    for (const sku of targetSkus) {
        const doorOptions = optionsData[sku];
        if (!Array.isArray(doorOptions) || doorOptions.length === 0) {
            console.log(`⏭️ Skipping ${sku}: No local options found.`);
            continue;
        }

        const productId = await getProductIdByHandle(sku);
        if (!productId) {
            console.log(`⚠️ Product not found on Shopify for handle: ${sku.toLowerCase().replace(/\s+/g, '-')}`);
            continue;
        }

        await setProductMetafield(productId, 'custom', 'door_options', JSON.stringify(doorOptions));
        console.log(`✅ Injected custom.door_options for ${sku}`);
    }

    console.log('🎉 Done.');
}

run().catch(error => {
    console.error('💥 Injection failed:', error.message);
    process.exit(1);
});
