require('dotenv').config();
const axios = require('axios');
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

async function run() {
    // using a dummy product ID from the store. 
    const pRes = await axios.post(GRAPHQL_URL, { query: `{ products(first:1) { edges { node { id } } } }` }, { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN } });
    const pid = pRes.data.data.products.edges[0].node.id;
    console.log("Setting empty array for", pid);
    
    const query = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { key value }
          userErrors { field message }
        }
      }
    `;
    const setVars = { metafields: [{ ownerId: pid, namespace: "custom", key: "product_category", type: "list.single_line_text_field", value: "[]" }] };
    const setRes = await axios.post(GRAPHQL_URL, { query, variables: setVars }, { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } });
    console.log(JSON.stringify(setRes.data, null, 2));
}
run();
