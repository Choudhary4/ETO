require('dotenv').config();
const fs = require('fs');

const SHOPIFY_URL = 'etodoorscorp.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';
const GRAPHQL_ENDPOINT = `https://${SHOPIFY_URL}/admin/api/${API_VERSION}/graphql.json`;

const categoriesData = JSON.parse(fs.readFileSync('magento_categories_data.json', 'utf8'));

async function shopifyGraphQL(query, variables) {
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
        throw new Error(JSON.stringify(result.errors));
    }
    return result.data;
}

// Proceeding straight to injection since the user confirmed custom.product_category exists
async function run() {
    const skus = Object.keys(categoriesData);
    console.log(`\n🚀 Starting category injection into 'custom.product_category' for ${skus.length} products...`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < skus.length; i++) {
        const sku = skus[i];
        const data = categoriesData[sku];

        if (!data || data.error || !data.category_names || data.category_names.length === 0) {
            console.log(`   ⏭️  [${i + 1}/${skus.length}] Skipping ${sku} - No categories or error.`);
            continue;
        }

        const handle = sku.toLowerCase().replace(/\s+/g, '-');

        // Find product by handle
        const query = `query { productByHandle(handle: "${handle}") { id title } }`;
        const pData = await shopifyGraphQL(query, {});

        if (!pData || !pData.productByHandle) {
            console.log(`   ⏭️  [${i + 1}/${skus.length}] Skipping ${sku} - Not found in Shopify (${handle})`);
            failCount++;
            continue;
        }

        const productId = pData.productByHandle.id;
        const categories = data.category_names;

        // Set metafield
        const mutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
                metafields { id key }
                userErrors { field message }
            }
        }`;

        const variables = {
            metafields: [{
                ownerId: productId,
                namespace: "custom",
                key: "product_category", // CHANGED FROM magento_categories
                type: "list.single_line_text_field",
                value: JSON.stringify(categories)
            }]
        };

        try {
            const result = await shopifyGraphQL(mutation, variables);
            if (result.metafieldsSet.userErrors && result.metafieldsSet.userErrors.length > 0) {
                console.log(`   ❌ [${i + 1}/${skus.length}] Error setting categories for ${sku}:`, JSON.stringify(result.metafieldsSet.userErrors));
                failCount++;
            } else {
                console.log(`   ✅ [${i + 1}/${skus.length}] Set ${categories.length} categories for ${sku} (${pData.productByHandle.title})`);
                successCount++;
            }

            // Wait slightly to respect Shopify rate limits
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            console.log(`   ❌ [${i + 1}/${skus.length}] GraphQL Exception for ${sku}: ${e.message}`);
            failCount++;
        }
    }

    console.log(`\n🎉 Upload Complete!`);
    console.log(`📊 Total: ${skus.length} | Success: ${successCount} | Not Found/Failed: ${failCount}`);
}

run().catch(e => console.error('Fatal error:', e));
