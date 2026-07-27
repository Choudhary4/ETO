require('dotenv').config();
const fs = require('fs');
const axios = require('axios');

// Environment Variables
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Path to Magento JSON (skip flags starting with --)
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const MAGENTO_JSON_PATH = args[0] || '../magento-extractor/all_magento_products.json';

// Shopify GraphQL Endpoint
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

const delay = ms => new Promise(res => setTimeout(res, ms));

// ── DRY RUN MODE ──────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');

// ── Fetch ALL Shopify products with pagination ────────────────────────────
async function fetchAllShopifyProducts() {
    const allProducts = [];
    let cursor = null;
    let hasNext = true;
    let page = 0;

    while (hasNext) {
        page++;
        const afterClause = cursor ? `, after: "${cursor}"` : '';
        const query = `{
            products(first: 50${afterClause}) {
                edges {
                    node {
                        id
                        title
                        handle
                        variants(first: 20) {
                            edges {
                                node {
                                    sku
                                }
                            }
                        }
                    }
                    cursor
                }
                pageInfo {
                    hasNextPage
                }
            }
        }`;

        try {
            const res = await axios.post(
                GRAPHQL_URL,
                { query },
                { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
            );

            const edges = res.data.data.products.edges;
            for (const edge of edges) {
                allProducts.push(edge.node);
                cursor = edge.cursor;
            }
            hasNext = res.data.data.products.pageInfo.hasNextPage;
            console.log(`  Page ${page}: fetched ${edges.length} products (total: ${allProducts.length})`);
        } catch (error) {
            console.error(`  Error fetching page ${page}:`, error.message);
            hasNext = false;
        }

        await delay(500);
    }

    return allProducts;
}

async function updateProductTitle(productGid, newTitle) {
    const mutation = `
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

    const variables = {
        input: {
            id: productGid,
            title: newTitle
        }
    };

    try {
        const res = await axios.post(
            GRAPHQL_URL,
            { query: mutation, variables },
            { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
        );

        const errors = res.data.data.productUpdate.userErrors;
        if (errors && errors.length > 0) {
            console.error(`  ⚠️ Error updating title:`, JSON.stringify(errors));
            return false;
        }
        return true;
    } catch (error) {
        console.error(`  Error updating product:`, error.message);
        return false;
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  🚀 Shopify Product Name Sync (from Magento JSON)');
    console.log('═══════════════════════════════════════════════════');
    
    if (DRY_RUN) {
        console.log('  🔍 DRY RUN MODE - No changes will be made\n');
    } else {
        console.log('  ⚡ LIVE MODE - Changes WILL be made\n');
    }

    // 1. Load Magento JSON
    const rawData = fs.readFileSync(MAGENTO_JSON_PATH, 'utf8');
    const magentoProducts = JSON.parse(rawData);
    console.log(`📂 Loaded ${magentoProducts.length} products from Magento JSON`);

    // 2. Build lookup maps from Magento data
    //    - SKU (lowercase) → name
    //    - Also extract base SKU (the part before any size suffix like "-36X80")
    const magentoBySkuLower = {};
    for (const product of magentoProducts) {
        if (product.sku && product.name) {
            magentoBySkuLower[product.sku.toLowerCase()] = product.name.trim();
        }
    }

    console.log(`🔑 Built lookup for ${Object.keys(magentoBySkuLower).length} Magento SKUs\n`);

    // 3. Fetch all Shopify products
    console.log('📥 Fetching all Shopify products...');
    const shopifyProducts = await fetchAllShopifyProducts();
    console.log(`\n📦 Total Shopify products: ${shopifyProducts.length}\n`);

    let updated = 0;
    let skipped = 0;
    let noMatch = 0;
    let errors = 0;

    // 4. For each Shopify product, try to match with Magento
    for (let i = 0; i < shopifyProducts.length; i++) {
        const product = shopifyProducts[i];
        const handle = product.handle;
        
        // Get all SKUs for this product's variants
        const variantSkus = product.variants.edges.map(v => v.node.sku).filter(Boolean);
        
        // Try to extract base SKU from first variant (e.g., "RIPON-36X80" → "RIPON")
        let baseSku = '';
        if (variantSkus.length > 0) {
            // Remove size suffix like "-36X80", "-32X96", "-24X80", "-72X96" etc.
            baseSku = variantSkus[0].replace(/-\d+X\d+$/i, '');
        }

        // Try matching in order: exact SKU → base SKU → handle
        let magentoName = null;
        let matchedBy = '';

        // Try base SKU match (most reliable)
        if (baseSku && magentoBySkuLower[baseSku.toLowerCase()]) {
            magentoName = magentoBySkuLower[baseSku.toLowerCase()];
            matchedBy = `base SKU "${baseSku}"`;
        }
        // Try handle match
        else if (magentoBySkuLower[handle.toLowerCase()]) {
            magentoName = magentoBySkuLower[handle.toLowerCase()];
            matchedBy = `handle "${handle}"`;
        }
        // Try handle with common variations
        else {
            // Try without hyphens
            const handleNoDash = handle.replace(/-/g, '');
            if (magentoBySkuLower[handleNoDash.toLowerCase()]) {
                magentoName = magentoBySkuLower[handleNoDash.toLowerCase()];
                matchedBy = `handle (no-dash) "${handleNoDash}"`;
            }
        }

        if (!magentoName) {
            // No match found
            if (i < 20 || i % 50 === 0) { // Only log first 20 + every 50th to avoid spam
                console.log(`[${i + 1}/${shopifyProducts.length}] "${product.title}" (SKU: ${baseSku || 'none'}) — ❌ No Magento match`);
            }
            noMatch++;
            continue;
        }

        // Check if title already matches
        if (product.title === magentoName) {
            console.log(`[${i + 1}/${shopifyProducts.length}] "${product.title}" — ✔️  Already correct (matched by ${matchedBy})`);
            skipped++;
            continue;
        }

        // Update title
        console.log(`[${i + 1}/${shopifyProducts.length}] Matched by ${matchedBy}:`);
        console.log(`  📝 Current:  "${product.title}"`);
        console.log(`  ➡️  New:     "${magentoName}"`);

        if (DRY_RUN) {
            console.log(`  🔍 [DRY RUN] Would update.`);
            updated++;
        } else {
            const success = await updateProductTitle(product.id, magentoName);
            if (success) {
                console.log(`  ✅ Updated successfully!`);
                updated++;
            } else {
                console.log(`  ⚠️ Failed to update.`);
                errors++;
            }
            await delay(500);
        }
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  📊 SYNC RESULTS');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  ✅ Updated:    ${updated}`);
    console.log(`  ✔️  Skipped:    ${skipped} (already correct)`);
    console.log(`  ❌ No match:   ${noMatch}`);
    console.log(`  ⚠️  Errors:     ${errors}`);
    console.log(`  📦 Total:      ${shopifyProducts.length}`);
    console.log('═══════════════════════════════════════════════════');
}

main();
