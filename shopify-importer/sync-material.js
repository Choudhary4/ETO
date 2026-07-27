require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const CSV_PATH = process.argv[2] || '/Users/saurabhkuntal/Downloads/Zoho Books Items - Shopify (4).csv';

const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

const delay = ms => new Promise(res => setTimeout(res, ms));

async function updateMaterialMetafield(productHandle, materialStr) {
    if (!materialStr || materialStr.trim() === '') {
        return;
    }

    const materialValue = materialStr.trim();

    // 1. Get Product ID
    const getProductQuery = `
      query {
        products(first: 1, query: "handle:${productHandle}") {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    `;

    try {
        const productRes = await axios.post(
            GRAPHQL_URL,
            { query: getProductQuery },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        let edges = productRes.data.data.products.edges;
        if (!edges || edges.length === 0) {
            console.log(`⚠️ Product not found for handle: ${productHandle}. Skipping.`);
            return;
        }

        const product = edges[0].node;
        const productId = product.id;

        // 2. Set Metafield
        const updateMetafieldQuery = `
            mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                metafields {
                  id
                  namespace
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

        const metaVars = {
            metafields: [{
                ownerId: productId,
                namespace: "custom",
                key: "material",
                type: "single_line_text_field",
                value: materialValue
            }]
        };

        const metaRes = await axios.post(
            GRAPHQL_URL,
            { query: updateMetafieldQuery, variables: metaVars },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        const metaData = metaRes.data.data.metafieldsSet;
        if (metaData.userErrors && metaData.userErrors.length > 0) {
            console.error(`❌ Error updating material for ${productHandle}:`, metaData.userErrors);
        } else {
            console.log(`✅ Success: Set material "${materialValue}" for ${productHandle}`);
        }

    } catch (err) {
        console.error(`❌ API Error for handle ${productHandle}:`, err.response ? err.response.data : err.message);
    }
}

async function processCSV() {
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`❌ CSV File not found at: ${CSV_PATH}`);
        return;
    }

    const products = {};

    console.log("Reading CSV file...");

    fs.createReadStream(CSV_PATH)
        .pipe(csv())
        .on('data', (row) => {
            const handle = row['Handle'];
            const species = row['Species'];
            if (handle && species) {
                // Group by handle, picking the first found species for the product
                if (!products[handle]) {
                    products[handle] = species;
                }
            }
        })
        .on('end', async () => {
            const handles = Object.keys(products);
            console.log(`Finished reading CSV. Found ${handles.length} unique products with Species.`);

            for (const handle of handles) {
                const material = products[handle];
                await updateMaterialMetafield(handle, material);
                // Respect rate limits: Add a slight delay between updates
                await delay(300);
            }

            console.log("🎉 Sync process completed!");
        });
}

processCSV();
