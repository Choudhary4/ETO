require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');

// Environment Variables
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
// Hardcode the specific path to the new V2 CSV, but allow override
const CSV_PATH = process.argv[2] || process.env.CSV_FILE_PATH || '/Users/saurabhkuntal/Downloads/V2_Door_Categories.csv';

// Shopify GraphQL Endpoint
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

const delay = ms => new Promise(res => setTimeout(res, ms));

async function updateProductMetafield(sku, categoryString) {
    if (!categoryString) return;

    // Split by semicolon and trim
    let categoryArray = categoryString.split(';').map(c => c.trim()).filter(Boolean);
    
    if (categoryArray.length === 0) return;

    // Search for variant by SKU
    const getVariantIdQuery = `
      query {
        productVariants(first: 1, query: "sku:${sku}") {
          edges {
            node {
              id
              sku
            }
          }
        }
      }
    `;

    try {
        const variantRes = await axios.post(
            GRAPHQL_URL,
            { query: getVariantIdQuery },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        let edges = variantRes.data.data.productVariants.edges;
        let variantId;

        if (!edges || edges.length === 0) {
            console.log(`⚠️ Variant not found in Shopify for SKU: ${sku}. Skipping metafield update.`);
            return;
        } else {
            variantId = edges[0].node.id;
        }

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

        const variables = {
            metafields: [
                {
                    ownerId: variantId,
                    namespace: "custom", // Matching the existing structure
                    key: "product_category", 
                    type: "list.single_line_text_field", 
                    value: JSON.stringify(categoryArray)
                }
            ]
        };

        const updateRes = await axios.post(
            GRAPHQL_URL,
            { query: setMetafieldQuery, variables: variables },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        const errors = updateRes.data.data.metafieldsSet.userErrors;
        if (errors && errors.length > 0) {
            console.error(`⚠️ Error updating categories for SKU ${sku}:`, JSON.stringify(errors));
        } else {
            console.log(`✅ Successfully updated Category ${JSON.stringify(categoryArray)} for SKU: ${sku}`);
        }

    } catch (error) {
        console.error(`Error processing SKU ${sku}:`, error.message);
    }
}

async function processCSV() {
    console.log(`🚀 Starting V2 CSV Categories Sync from: ${CSV_PATH}`);
    const results = [];

    if (!fs.existsSync(CSV_PATH)) {
        console.error(`❌ CSV File not found at path: ${CSV_PATH}`);
        return;
    }

    fs.createReadStream(CSV_PATH)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            console.log(`📂 Found ${results.length} total rows. Extracting unique SKUs...`);

            // 1. Group by SKU
            const skuToCategory = {};
            for (const row of results) {
                const sku = row['SKU'];
                const category = row['New Categories'];

                if (sku && category && !skuToCategory[sku]) {
                    skuToCategory[sku] = category;
                }
            }

            const uniqueSKUs = Object.keys(skuToCategory);
            console.log(`🔍 Found ${uniqueSKUs.length} unique SKUs to process.`);

            // 2. Loop through unique SKUs
            for (let i = 0; i < uniqueSKUs.length; i++) {
                const sku = uniqueSKUs[i];
                const category = skuToCategory[sku];

                console.log(`[${i + 1}/${uniqueSKUs.length}] Processing SKU: ${sku}...`);
                await updateProductMetafield(sku, category);
                await delay(500); // 0.5s pause to respect API limits
            }

            console.log("🎉 All V2 metafields synced successfully!");
        });
}

processCSV();
