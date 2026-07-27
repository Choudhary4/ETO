require('dotenv').config();
const axios = require('axios');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

async function testUpdateProductMetafield(productHandle, categoryString) {
    let categoryArray = [];
    try {
        categoryArray = JSON.parse(categoryString);
        if (!Array.isArray(categoryArray)) {
            categoryArray = [categoryString];
        }
    } catch (err) {
        categoryArray = [categoryString];
    }

    categoryArray = categoryArray.map(c => c.trim()).filter(Boolean);

    if (categoryArray.length === 0) return;

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

        if (!edges || edges.length === 0) {
            console.log(`⚠️ Product not found in Shopify for handle: ${productHandle}. Skipping metafield update.`);
            return;
        } else {
            productId = edges[0].node.id;
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
                    ownerId: productId,
                    namespace: "custom",
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
            console.error(`⚠️ Error updating categories for ${productHandle}:`, JSON.stringify(errors));
        } else {
            console.log(`✅ Successfully updated Category ${JSON.stringify(categoryArray)} for: ${productHandle}`);
        }

    } catch (error) {
        console.error(`Error processing ${productHandle}:`, error?.response?.data || error.message);
    }
}

console.log("Testing sync for 'Ripon' handle...");
testUpdateProductMetafield('ripon', '["Metal", "Test Category"]');
