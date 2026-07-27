require('dotenv').config();
const axios = require('axios');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchProductsWithMetafield(cursor = null) {
    const query = `
      query getProducts($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              handle
              metafield(namespace: "custom", key: "product_category") {
                id
              }
            }
          }
        }
      }
    `;

    const variables = { cursor };

    try {
        const res = await axios.post(
            GRAPHQL_URL,
            { query, variables },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );
        return res.data.data.products;
    } catch (error) {
        console.error("Error fetching products:", error.message);
        return null;
    }
}

async function deleteMetafield(productId, handle) {
    const query = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
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
        metafields: [{ 
            ownerId: productId, 
            namespace: "custom", 
            key: "product_category", 
            type: "list.single_line_text_field", 
            value: "[]" 
        }] 
    };

    try {
        const res = await axios.post(
            GRAPHQL_URL,
            { query, variables },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );
        
        if (res.data.errors) {
             console.error(`⚠️ GraphQL Error clearing category for ${handle}:`, JSON.stringify(res.data.errors));
             return;
        }

        const errors = res.data?.data?.metafieldsSet?.userErrors;
        if (errors && errors.length > 0) {
            console.error(`⚠️ Error clearing category for ${handle}:`, JSON.stringify(errors));
        } else {
            console.log(`🗑️ Successfully cleared category for: ${handle}`);
        }
    } catch (error) {
        console.error(`Error clearing metafield for ${handle}:`, error.message);
    }
}

async function clearAllCategories() {
    console.log("🚀 Starting process to delete all custom.product_category metafields...");
    let hasNextPage = true;
    let cursor = null;
    let totalProcessed = 0;
    let totalDeleted = 0;

    while (hasNextPage) {
        const productsData = await fetchProductsWithMetafield(cursor);
        if (!productsData) {
            console.error("❌ Failed to fetch products. Aborting.");
            break;
        }

        const products = productsData.edges;
        for (const edge of products) {
            const product = edge.node;
            totalProcessed++;

            if (product.metafield && product.metafield.id) {
                await deleteMetafield(product.id, product.handle);
                totalDeleted++;
                await delay(250); // Respect rate limits
            }
        }

        hasNextPage = productsData.pageInfo.hasNextPage;
        cursor = productsData.pageInfo.endCursor;

        console.log(`⏳ Processed ${totalProcessed} products so far...`);
    }

    console.log(`🎉 Finished! Processed ${totalProcessed} products total.`);
    console.log(`✅ Deleted ${totalDeleted} categories in total.`);
}

clearAllCategories();
