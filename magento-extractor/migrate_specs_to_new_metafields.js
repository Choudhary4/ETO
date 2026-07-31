require('dotenv').config({ path: require('path').join(__dirname, '../shopify-importer/.env') });
const axios = require('axios');

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GRAPHQL_URL = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/graphql.json`;

const headers = {
    'X-Shopify-Access-Token': ACCESS_TOKEN,
    'Content-Type': 'application/json'
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Simple parser to extract data from the raw HTML/text blob
function parseSpecificationData(text) {
    if (!text) return {};
    
    // Strip HTML tags just in case
    const cleanText = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ');

    const result = {};

    const extractors = [
        { key: 'wood_species', regex: /Wood Species:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'construction', regex: /Construction:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'warranty', regex: /Warranty:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'project_application', regex: /Project Application:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'pre_hanging', regex: /Pre-Hanging(?:\s*Available)?:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'custom_capabilities', regex: /Custom Capabilities:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'u_factor', regex: /(?:NFRC Rated\s*)?U-Factor:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'shgc', regex: /(?:NFRC Rated\s*)?SHGC:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'stc_rating', regex: /STC Rating:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'oitc_rating', regex: /OITC Rating:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'r_value', regex: /R-Value:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'finish', regex: /Finish:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i },
        { key: 'fire_rated', regex: /Fire Rating:\s*(.*?)(?=(?:\s*[A-Z][a-zA-Z-]+\s*:|$))/i }
    ];

    extractors.forEach(ext => {
        const match = cleanText.match(ext.regex);
        if (match && match[1]) {
            result[ext.key] = match[1].trim();
        }
    });

    return result;
}

async function run() {
    let hasNextPage = true;
    let cursor = null;
    let processed = 0;

    console.log('🔄 Starting Specification Migration...');

    while (hasNextPage) {
        const query = `
            query getProducts($cursor: String) {
                products(first: 50, after: $cursor) {
                    pageInfo { hasNextPage endCursor }
                    edges {
                        node {
                            id
                            handle
                            tab_spec: metafield(namespace: "custom", key: "tab_specification") {
                                value
                            }
                        }
                    }
                }
            }
        `;

        try {
            const res = await axios.post(GRAPHQL_URL, { query, variables: { cursor } }, { headers });
            const data = res.data.data.products;

            for (const edge of data.edges) {
                const product = edge.node;
                const tabSpecRaw = product.tab_spec ? product.tab_spec.value : null;

                if (tabSpecRaw) {
                    const parsedData = parseSpecificationData(tabSpecRaw);
                    
                    if (Object.keys(parsedData).length > 0) {
                        const metafieldsToSet = [];
                        
                        for (const [key, value] of Object.entries(parsedData)) {
                            // Truncate if too long (single_line_text_field limit)
                            let finalValue = value.substring(0, 255);
                            metafieldsToSet.push({
                                ownerId: product.id,
                                namespace: 'custom',
                                key: key,
                                type: 'single_line_text_field',
                                value: finalValue
                            });
                        }

                        if (metafieldsToSet.length > 0) {
                            const mutation = `
                                mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
                                    metafieldsSet(metafields: $metafields) {
                                        userErrors { field message }
                                    }
                                }
                            `;
                            
                            const mutRes = await axios.post(GRAPHQL_URL, { mutation, variables: { metafields: metafieldsToSet } }, { headers });
                            if (mutRes.data.data.metafieldsSet.userErrors.length > 0) {
                                console.error(`❌ Errors updating ${product.handle}:`, mutRes.data.data.metafieldsSet.userErrors);
                            } else {
                                console.log(`✅ Extracted & updated ${metafieldsToSet.length} specs for ${product.handle}`);
                            }
                            await delay(250); // Prevent hitting rate limits
                        }
                    }
                }
                processed++;
            }

            hasNextPage = data.pageInfo.hasNextPage;
            cursor = data.pageInfo.endCursor;

        } catch (err) {
            console.error('❌ GraphQL Error:', err.response?.data || err.message);
            break;
        }
    }

    console.log(`🎉 Migration Complete! Processed ${processed} products.`);
}

run();
