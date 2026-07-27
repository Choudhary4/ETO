require('dotenv').config();
const fs = require('fs');
const axios = require('axios');

// Environment Variables
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const JSON_PATH = '../magento-extractor/magento_tabs_data.json';

// Shopify GraphQL Endpoint
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

// We wait 1 second between requests to avoid Shopify API Rate Limits (Leaky Bucket)
const delay = ms => new Promise(res => setTimeout(res, ms));

async function updateProductTabs(productHandle, tabsData) {
    // Using `products(query)` is more robust than `productByHandle` for drafted/archived items.
    const getProductIdQuery = `
      query {
        products(first: 1, query: "handle:${productHandle}") {
          edges {
            node {
              id
            }
          }
        }
      }
    `;

    try {
        const productRes = await axios.post(
            GRAPHQL_URL,
            { query: getProductIdQuery },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        let edges = productRes.data.data.products.edges;

        if (!edges || edges.length === 0) {
            console.log(`⚠️ Product not found for handle: ${productHandle}. Skipping...`);
            return;
        }

        const productId = edges[0].node.id;

        // Set the Metafields using metafieldsSet
        const setMetafieldQuery = `
            mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                metafields {
                  key
                  namespace
                  value
                }
                userErrors {
                  field
                  message
                }
              }
            }
        `;

        const metafields = [];

        if (tabsData.overview) {
            metafields.push({
                ownerId: productId,
                namespace: "custom",
                key: "tab_overview",
                type: "multi_line_text_field",
                value: tabsData.overview
            });
        }

        if (tabsData.specification) {
            metafields.push({
                ownerId: productId,
                namespace: "custom",
                key: "tab_specification",
                type: "multi_line_text_field",
                value: tabsData.specification
            });
        }

        if (tabsData.lead_time) {
            metafields.push({
                ownerId: productId,
                namespace: "custom",
                key: "tab_lead_time",
                type: "multi_line_text_field",
                value: tabsData.lead_time
            });
        }

        if (metafields.length === 0) {
            console.log(`No valid tab data for ${productHandle}`);
            return;
        }

        const variables = { metafields };

        const updateRes = await axios.post(
            GRAPHQL_URL,
            { query: setMetafieldQuery, variables: variables },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        const errors = updateRes.data.data.metafieldsSet.userErrors;
        if (errors && errors.length > 0) {
            console.error(`⚠️ Error updating ${productHandle}:`, errors);
        } else {
            console.log(`✅ Successfully updated Tabs for: ${productHandle}`);
        }

    } catch (error) {
        console.error(`Error processing ${productHandle}:`, error.message);
    }
}

async function processData() {
    console.log("🚀 Starting Tabs import...");

    try {
        const data = fs.readFileSync(JSON_PATH, 'utf8');
        const tabsData = JSON.parse(data);

        const keys = Object.keys(tabsData);
        console.log(`📂 Found ${keys.length} products to process.`);

        for (const key of keys) {
            // Shopify handles are typically lowercase
            const handle = key.toLowerCase();
            const dataForProduct = tabsData[key];

            // Skip entries that just have "error"
            if (dataForProduct.error) {
                console.log(`Skipping ${handle} due to extraction error.`);
                continue;
            }

            await updateProductTabs(handle, dataForProduct);
            await delay(1000); // 1 sec delay to avoid rate limit
        }

        console.log("🎉 All products processed!");
    } catch (err) {
        console.error("Failed to read or parse JSON file:", err.message);
    }
}

// Run the script
processData();
