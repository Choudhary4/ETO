require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');

// Environment Variables
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const CSV_PATH = process.env.CSV_FILE_PATH;

// Shopify GraphQL Endpoint
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

// We wait 1 second between requests to avoid Shopify API Rate Limits (Leaky Bucket)
const delay = ms => new Promise(res => setTimeout(res, ms));

async function updateProductMetafield(productHandle, categoryString) {
  if (!categoryString) return;

  // 1. Convert "A;B;C" into an actual array: ["A", "B", "C"]
  const categoryArray = categoryString.split(';').map(cat => cat.trim()).filter(Boolean);

  // We need the internal Product ID to update its metafields.
  // First query: Get the Product ID by searching for its handle.
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
    let productId;

    // --- CREATE PRODUCT IF MISSING ---
    if (!edges || edges.length === 0) {
      console.log(`⚠️ Product not found for handle: ${productHandle}. Creating it now...`);

      const createProductQuery = `
              mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                  product {
                    id
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `;

      const createVariables = {
        input: {
          title: productHandle, // Use handle as temporary title
          handle: productHandle,
          status: "DRAFT" // Create as draft to be safe
        }
      };

      const createRes = await axios.post(
        GRAPHQL_URL,
        { query: createProductQuery, variables: createVariables },
        { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
      );

      const createErrors = createRes.data.data.productCreate.userErrors;
      if (createErrors && createErrors.length > 0) {
        console.error(`❌ Failed to create product ${productHandle}:`, createErrors);
        return; // Stop if we can't create it
      }

      console.log(`✨ Successfully created missing product: ${productHandle}`);
      productId = createRes.data.data.productCreate.product.id;
    } else {
      productId = edges[0].node.id;
    }

    // 2. Second Query: Set the Metafield using metafieldsSet
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
          ownerId: productId,
          namespace: "custom",
          key: "product_category",
          type: "list.single_line_text_field", // Required Type for Shopify Lists
          value: JSON.stringify(categoryArray) // Arrays MUST be stringified in the payload
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
      console.error(`⚠️ Error updating ${productHandle}:`, errors);
    } else {
      console.log(`✅ Successfully updated Category for: ${productHandle}`);
    }

  } catch (error) {
    console.error(`Error processing ${productHandle}:`, error.message);
  }
}

async function processCSV() {
  console.log("🚀 Starting CSV import...");
  const results = [];

  // Read and parse the CSV
  fs.createReadStream(CSV_PATH)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`📂 Found ${results.length} rows. Processing one by one...`);

      // Loop through each row
      for (const row of results) {
        const handle = row['Handle'];
        // Using the exact header from Zoho exports
        const rawCategory = row['Product Category (product.metafields.custom.product_category)'];

        // Fallback attempt just in case the header is slightly different in this file
        const backupCategory = row['Product Category'] || row['product_category'] || rawCategory;

        if (handle && backupCategory) {
          await updateProductMetafield(handle, backupCategory);
          await delay(1000); // Wait 1 second to respect API limits
        }
      }

      console.log("🎉 All products processed!");
    });
}

// Run the script
processCSV();
