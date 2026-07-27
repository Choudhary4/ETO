require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');

// Environment Variables
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const CSV_PATH = process.argv[2] || process.env.CSV_FILE_PATH || '/Users/saurabhkuntal/Downloads/Zoho Books Items - Shopify (3).csv';

// Shopify GraphQL Endpoint
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

const delay = ms => new Promise(res => setTimeout(res, ms));

async function updateProduct(productHandle, categoryString, originalTitle) {
    let categoryArray = [];
    if (categoryString) {
        try {
            categoryArray = JSON.parse(categoryString);
            if (!Array.isArray(categoryArray)) {
                categoryArray = String(categoryString).split(';');
            }
        } catch (err) {
            categoryArray = String(categoryString).split(';');
        }
        categoryArray = categoryArray.map(c => c.trim()).filter(Boolean);
    }

    const getProductQuery = `
      query {
        products(first: 1, query: "handle:${productHandle}") {
          edges {
            node {
              id
              title
              metafield(namespace: "custom", key: "product_category") {
                id
              }
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
        const currentTitle = product.title;
        const currentMetafieldId = product.metafield ? product.metafield.id : null;

        // 1. Fix Title if it ends with " Doors" and matches Handle logic
        // Only strip " Doors" if the title contains it at the end.
        if (currentTitle.trim().endsWith(" Doors")) {
            const newTitle = currentTitle.replace(/ Doors$/, "").trim();
            const updateTitleQuery = `
                mutation productUpdate($input: ProductInput!) {
                  productUpdate(input: $input) {
                    product {
                      id
                      title
                    }
                    userErrors {
                      field
                      message
                    }
                  }
                }
            `;
            const titleVars = {
                input: {
                    id: productId,
                    title: newTitle
                }
            };
            const titleRes = await axios.post(GRAPHQL_URL, { query: updateTitleQuery, variables: titleVars }, { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } });
            console.log(`✅ Fixed Title for ${productHandle}: "${currentTitle}" -> "${newTitle}"`);
            await delay(250);
        }

        // 2. Update or Delete Category Metafield
        if (categoryArray.length === 0) {
            // Clear metafield if it exists by setting empty array
            if (currentMetafieldId) {
                const clearMetafieldQuery = `
                    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
                      metafieldsSet(metafields: $metafields) {
                        metafields {
                          key
                        }
                        userErrors {
                          field
                          message
                        }
                      }
                    }
                `;
                const clearVars = {
                    metafields: [
                        {
                            ownerId: productId,
                            namespace: "custom",
                            key: "product_category",
                            type: "list.single_line_text_field",
                            value: "[]"
                        }
                    ]
                };
                await axios.post(GRAPHQL_URL, { query: clearMetafieldQuery, variables: clearVars }, { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } });
                console.log(`🗑️ Cleared categories for ${productHandle}`);
            } else {
                console.log(`⏭️ No categories to set and none exist for ${productHandle}.`);
            }
        } else {
            // Set new categories
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
            const setVars = {
                metafields: [
                    {
                        ownerId: productId,
                        namespace: "custom",
                        key: "product_category",
                        type: "list.single_line_text_field",
                        value: JSON.stringify(categoryArray)
                    }
                ]
            };
            const updateRes = await axios.post(GRAPHQL_URL, { query: setMetafieldQuery, variables: setVars }, { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } });
            
            const errors = updateRes.data.data.metafieldsSet.userErrors;
            if (errors && errors.length > 0) {
                console.error(`⚠️ Error updating categories for ${productHandle}:`, JSON.stringify(errors));
            } else {
                console.log(`✅ Set categories ${JSON.stringify(categoryArray)} for: ${productHandle}`);
            }
        }

    } catch (error) {
        console.error(`Error processing ${productHandle}:`, error.message);
    }
}

async function processCSV() {
    console.log(`🚀 Starting CSV Categories Sync from: ${CSV_PATH}`);
    const results = [];

    if (!fs.existsSync(CSV_PATH)) {
        console.error(`❌ CSV File not found at path: ${CSV_PATH}`);
        return;
    }

    fs.createReadStream(CSV_PATH)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            console.log(`📂 Found ${results.length} total rows. Extracting unique handles...`);

            const handleData = {};
            for (const row of results) {
                const handle = row['Handle'];
                const title = row['Title'];
                const category = row['Product Category (product.metafields.custom.product_category)'] ||
                    row['Product Category'];

                // We keep track of the category string. If a handle appears multiple times, 
                // the first non-empty category string usually takes precedence, or we just overwrite.
                if (handle && !handleData[handle]) {
                    handleData[handle] = { category: category || "", originalTitle: title };
                } else if (handle && handleData[handle] && !handleData[handle].category && category) {
                    handleData[handle].category = category;
                }
            }

            const uniqueHandles = Object.keys(handleData);
            console.log(`🔍 Found ${uniqueHandles.length} unique products to process.`);

            for (let i = 0; i < uniqueHandles.length; i++) {
                const handle = uniqueHandles[i];
                const data = handleData[handle];

                console.log(`[${i + 1}/${uniqueHandles.length}] Processing Handle: ${handle}...`);
                await updateProduct(handle, data.category, data.originalTitle);
                await delay(500); // Rate limiting
            }

            console.log("🎉 All products synced successfully!");
        });
}

processCSV();
