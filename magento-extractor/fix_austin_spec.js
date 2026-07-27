require('dotenv').config({ path: require('path').join(__dirname, '../shopify-importer/.env') });
const axios = require('axios');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

// Clean HTML for Austin's specification tab
const AUSTIN_CLEAN_SPEC = `<ul>
  <li><strong>Pre-Hanging Available:</strong> Single door and double door options.</li>
  <li><strong>Construction:</strong> Fiberglass (Stainable &amp; Paintable) with 3&rdquo; full perimeter LVL bloc.</li>
  <li><strong>Warranty:</strong> 1 Year Warranty</li>
  <li><strong>Project Application:</strong> Used for new construction and replacement.</li>
  <li><strong>Collection:</strong> White brushed grain skin (can be painted or stained)</li>
  <li><strong>NFRC Rated U-Factor:</strong> 0.39</li>
  <li><strong>NFRC Rated SHGC:</strong> 0.02</li>
  <li><strong>Collection:</strong> White Brushed Skin (paintable fiberglass door)</li>
  <li><strong><span style="text-decoration: underline;">Benefits of Fiberglass Doors:</span></strong>
    <ul>
      <li>1. &ldquo;Durability&rdquo;: Fiberglass doors won&rsquo;t dent, rot, or rust. Withstands wide temperature ranges.</li>
      <li>2. &ldquo;Beauty&rdquo;: Fiberglass doors are made to look and feel like real wood.</li>
      <li>3. &ldquo;Low Maintenance&rdquo;: Durable Fiberglass construction requires less maintenance.</li>
      <li>4. &ldquo;Energy Efficiency&rdquo;: Solid Foam core offers 5 times more insulation.</li>
    </ul>
  </li>
  <li><strong>Collection: White Brushed Grain Skin (paintable and stainable fiberglass door)</strong><br />Our White Brushed Skin Series is crafted with a pre-coated white surface designed to minimize the visibility of scratches.</li>
</ul>`;

async function fixAustinSpec() {
    // Step 1: Get Austin product ID
    const getIdQuery = `
      query {
        products(first: 1, query: "handle:austin") {
          edges { node { id } }
        }
      }
    `;
    const res = await axios.post(GRAPHQL_URL, { query: getIdQuery }, {
        headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' }
    });

    const edges = res.data.data.products.edges;
    if (!edges || edges.length === 0) {
        console.error('❌ Austin product not found!'); return;
    }
    const productId = edges[0].node.id;
    console.log(`✅ Found Austin product: ${productId}`);

    // Step 2: Update the tab_specification metafield with clean HTML
    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { key namespace value }
          userErrors { field message }
        }
      }
    `;
    const variables = {
        metafields: [{
            ownerId: productId,
            namespace: "custom",
            key: "tab_specification",
            type: "multi_line_text_field",
            value: AUSTIN_CLEAN_SPEC
        }]
    };

    const mutRes = await axios.post(GRAPHQL_URL, { query: mutation, variables }, {
        headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' }
    });

    const errors = mutRes.data.data.metafieldsSet.userErrors;
    if (errors && errors.length > 0) {
        console.error('❌ Errors:', JSON.stringify(errors, null, 2));
    } else {
        console.log('✅ Austin tab_specification metafield updated with clean HTML!');
        console.log('🔄 Refresh https://etodoorscorp.myshopify.com/products/austin to verify.');
    }
}

fixAustinSpec().catch(console.error);
