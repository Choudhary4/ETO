require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SHOPIFY_URL = 'etodoorscorp.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';
const GRAPHQL_ENDPOINT = `https://${SHOPIFY_URL}/admin/api/${API_VERSION}/graphql.json`;

const DATA_FILE = path.join(__dirname, 'magento_category_descriptions.json');
const categoryDescriptions = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};

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
        throw new Error(JSON.stringify(result.errors));
    }
    return result.data;
}

async function getAllCollections() {
    let collections = [];
    let hasNextPage = true;
    let cursor = null;
    
    while(hasNextPage) {
        const query = `
            query($cursor: String) {
                collections(first: 250, after: $cursor) {
                    pageInfo { hasNextPage endCursor }
                    edges {
                        node {
                            id
                            title
                            handle
                            descriptionHtml
                        }
                    }
                }
            }
        `;
        const data = await shopifyGraphQL(query, { cursor });
        const colls = data.collections;
        colls.edges.forEach(e => collections.push(e.node));
        hasNextPage = colls.pageInfo.hasNextPage;
        cursor = colls.pageInfo.endCursor;
    }
    return collections;
}

async function updateCollectionDescription(id, descriptionHtml) {
    const mutation = `
        mutation collectionUpdate($input: CollectionInput!) {
            collectionUpdate(input: $input) {
                collection { id }
                userErrors { field message }
            }
        }
    `;
    const result = await shopifyGraphQL(mutation, {
        input: { id, descriptionHtml }
    });
    if (result.collectionUpdate.userErrors && result.collectionUpdate.userErrors.length > 0) {
        throw new Error(JSON.stringify(result.collectionUpdate.userErrors));
    }
}

async function run() {
    console.log(`\n🚀 Fetching all collections from Shopify...`);
    const collections = await getAllCollections();
    console.log(`✅ Loaded ${collections.length} collections.`);

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (let i = 0; i < collections.length; i++) {
        const coll = collections[i];
        
        // Find matching category from Magento.
        const matchTitleKey = Object.keys(categoryDescriptions).find(k => k.toLowerCase() === coll.title.toLowerCase());
        
        if (!matchTitleKey) {
            console.log(`   ⏭️  [${i + 1}/${collections.length}] Skipping '${coll.title}' - Not found in Magento data.`);
            skipCount++;
            continue;
        }

        const mData = categoryDescriptions[matchTitleKey];
        if (!mData.description || mData.description.trim() === '') {
            console.log(`   ⏭️  [${i + 1}/${collections.length}] Skipping '${coll.title}' - No description in Magento.`);
            skipCount++;
            continue;
        }

        const newDesc = mData.description;

        // check if description matches roughly
        if (coll.descriptionHtml && coll.descriptionHtml.includes(newDesc.substring(0, 20))) {
             console.log(`   ✅  [${i + 1}/${collections.length}] Skipping '${coll.title}' - Description already matches.`);
             skipCount++;
             continue;
        }

        try {
            await updateCollectionDescription(coll.id, newDesc);
            console.log(`   ⬆️  [${i + 1}/${collections.length}] Updated description for '${coll.title}'`);
            successCount++;
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            console.log(`   ❌  [${i + 1}/${collections.length}] Failed to update '${coll.title}': ${e.message}`);
            failCount++;
        }
    }

    console.log(`\n🎉 Sync Complete!`);
    console.log(`📊 Total Collections: ${collections.length} | Updated: ${successCount} | Skipped: ${skipCount} | Failed: ${failCount}`);
}

run().catch(console.error);
