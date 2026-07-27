require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');

const SHOPIFY_DOMAIN = 'etodoorscorp.myshopify.com';
const API_VERSION = '2024-01';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const CSV_FILE_PATH = process.argv[2] || '/Users/saurabhkuntal/Downloads/Zoho Books Items - Shopify (1) (1)(in) (3).csv';

if (!ACCESS_TOKEN) {
    console.error('❌ Error: SHOPIFY_ACCESS_TOKEN is missing from .env');
    process.exit(1);
}

const shopifyGraphQL = async (query, variables = {}) => {
    try {
        const response = await axios.post(
            `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
            { query, variables },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': ACCESS_TOKEN,
                },
            }
        );

        if (response.data.errors) {
            console.error('GraphQL System Errors:', JSON.stringify(response.data.errors, null, 2));
            return null;
        }

        // Handle rate limit (throttleStatus)
        const cost = response.data.extensions?.cost;
        if (cost && cost.throttleStatus && cost.throttleStatus.currentlyAvailable < 200) {
            console.log('⚠️ Nearing rate limit, pausing for 2 seconds...');
            await new Promise(res => setTimeout(res, 2000));
        }

        return response.data.data;
    } catch (error) {
        console.error(`Request failed: ${error.message}`);
        if (error.response && error.response.status === 429) {
            console.warn('⚠️ Rate limit hit. Waiting 5 seconds before retrying...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            return shopifyGraphQL(query, variables);
        }
        return null;
    }
};

const getProductByHandle = async (handle) => {
    const query = `
        query getProduct($handle: String!) {
            productByHandle(handle: $handle) {
                id
                title
                status
                productType
                options {
                    id
                    name
                }
                variants(first: 250) {
                    edges {
                        node {
                            id
                            sku
                            title
                            price
                        }
                    }
                }
            }
        }
    `;
    const data = await shopifyGraphQL(query, { handle });
    return data ? data.productByHandle : null;
};

const buildMetafields = (productData) => {
    const metafields = [];
    if (productData.doorModel) {
        metafields.push({
            namespace: "custom",
            key: "door_model",
            type: "single_line_text_field",
            value: String(productData.doorModel)
        });
    }
    if (productData.productCategory) {
        let cleanCat = productData.productCategory;
        // The CSV has data like "[""Metal""]". Remove the extra quotes to make it a valid string list or keep robust.
        metafields.push({
            namespace: "custom",
            key: "product_category",
            type: "list.single_line_text_field",
            value: String(cleanCat)
        });
    }
    return metafields;
};

const createProduct = async (productData) => {
    const query = `
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

    let gqlStatus = "DRAFT";
    if (productData.status && productData.status.toLowerCase() === 'active') gqlStatus = "ACTIVE";
    if (productData.status && productData.status.toLowerCase() === 'archived') gqlStatus = "ARCHIVED";

    const input = {
        title: productData.title,
        handle: productData.handle,
        descriptionHtml: productData.bodyHtml,
        status: gqlStatus,
        productType: productData.type,
        metafields: buildMetafields(productData),
    };

    const data = await shopifyGraphQL(query, { input });
    if (data && data.productCreate && data.productCreate.userErrors.length > 0) {
        console.error(`Failed to create product ${productData.handle}:`, data.productCreate.userErrors);
        return null;
    }
    return data && data.productCreate && data.productCreate.product ? data.productCreate.product.id : null;
};

const updateProductBase = async (productId, productData) => {
    const query = `
        mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
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

    let gqlStatus = "DRAFT";
    if (productData.status && productData.status.toLowerCase() === 'active') gqlStatus = "ACTIVE";
    if (productData.status && productData.status.toLowerCase() === 'archived') gqlStatus = "ARCHIVED";

    const input = {
        id: productId,
        title: productData.title,
        descriptionHtml: productData.bodyHtml,
        status: gqlStatus,
        productType: productData.type,
        metafields: buildMetafields(productData),
    };

    const data = await shopifyGraphQL(query, { input });
    if (data && data.productUpdate && data.productUpdate.userErrors.length > 0) {
        console.error(`Failed to update product ${productId}:`, data.productUpdate.userErrors);
    }
    return data;
};

const bulkUpdateVariants = async (productId, variantsToUpdate) => {
    if (!variantsToUpdate || variantsToUpdate.length === 0) return;

    const query = `
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                userErrors {
                    field
                    message
                }
            }
        }
    `;

    const variants = variantsToUpdate.map(v => ({
        id: v.existingId,
        price: parseFloat(v.price) || 0,
        inventoryItem: { sku: v.sku || '' },
        optionValues: [
            {
                optionName: v.optionName || "Size",
                name: String(v.option1Value) || "Default Title"
            }
        ]
    }));

    const data = await shopifyGraphQL(query, { productId, variants });
    if (data && data.productVariantsBulkUpdate && data.productVariantsBulkUpdate.userErrors.length > 0) {
        console.error(`Failed to bulk update variants for ${productId}:`, JSON.stringify(data.productVariantsBulkUpdate.userErrors));
    }
};

const bulkCreateVariants = async (productId, newVariants) => {
    if (!newVariants || newVariants.length === 0) return;

    const query = `
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
                userErrors {
                    field
                    message
                }
            }
        }
    `;

    const variants = newVariants.map(v => ({
        price: parseFloat(v.price) || 0,
        inventoryItem: { sku: v.sku || '' },
        optionValues: [
            {
                optionName: v.optionName || "Size",
                name: String(v.option1Value) || "Default Title"
            }
        ]
    }));

    const data = await shopifyGraphQL(query, { productId, variants });
    if (data && data.productVariantsBulkCreate && data.productVariantsBulkCreate.userErrors.length > 0) {
        console.error(`Failed to bulk create variants for ${productId}:`, JSON.stringify(data.productVariantsBulkCreate.userErrors));
    }
};

const groupedProducts = {};

console.log(`📖 Reading CSV file: ${CSV_FILE_PATH}`);
fs.createReadStream(CSV_FILE_PATH)
    .pipe(csv())
    .on('data', (row) => {
        const handle = row['Handle'];
        if (!handle) return;

        if (!groupedProducts[handle]) {
            groupedProducts[handle] = {
                handle: handle,
                title: row['Title'],
                bodyHtml: row['Body (HTML)'],
                status: row['Status'],
                type: row['Type'],
                published: row['Published'],
                doorModel: row['Door Model'],
                productCategory: row['Product Category (product.metafields.custom.product_category)'],
                variants: []
            };
        }

        if (row['Option1 Value'] || row['Variant SKU']) {
            groupedProducts[handle].variants.push({
                sku: row['Variant SKU'],
                price: row['Variant Price'],
                optionName: row['Option1 Name'],
                option1Value: row['Option1 Value'],
                inventoryPolicy: row['Variant Inventory Policy'],
                inventoryTracker: row['Variant Inventory Tracker']
            });
        }
    })
    .on('end', async () => {
        const handles = Object.keys(groupedProducts);
        console.log(`✅ Parsed ${handles.length} unique products from CSV.`);
        console.log(`🚀 Starting Full Data Sync (Create & Update all columns)...`);

        for (let i = 0; i < handles.length; i++) {
            const handle = handles[i];
            const productData = groupedProducts[handle];

            console.log(`[${i + 1}/${handles.length}] Processing: ${handle}`);

            const existingProduct = await getProductByHandle(handle);

            let productId;
            const variantsToUpdate = [];
            const variantsToCreate = [];

            if (!existingProduct) {
                console.log(`   ➕ Creating new product...`);
                productId = await createProduct(productData);
                if (!productId) continue;

                for (const v of productData.variants) {
                    variantsToCreate.push(v);
                }
            } else {
                productId = existingProduct.id;
                console.log(`   🔄 Updating existing product...`);
                await updateProductBase(productId, productData);

                const currentVariants = existingProduct.variants.edges.map(e => e.node);

                for (const csvVariant of productData.variants) {
                    // Match by option name first for exactness, fallback to SKU
                    // Since Option1Value is the title in variant node
                    const matchedExisting = currentVariants.find(v =>
                        (v.title && v.title === csvVariant.option1Value) ||
                        (v.sku && v.sku === csvVariant.sku)
                    );

                    if (matchedExisting) {
                        csvVariant.existingId = matchedExisting.id;
                        variantsToUpdate.push(csvVariant);
                    } else {
                        variantsToCreate.push(csvVariant);
                    }
                }
            }

            if (variantsToCreate.length > 0) {
                const chunks = [];
                for (let j = 0; j < variantsToCreate.length; j += 100) {
                    chunks.push(variantsToCreate.slice(j, j + 100));
                }
                for (const chunk of chunks) {
                    await bulkCreateVariants(productId, chunk);
                }
                console.log(`   ➕ Created ${variantsToCreate.length} new variants.`);
            }

            if (variantsToUpdate.length > 0) {
                const chunks = [];
                for (let j = 0; j < variantsToUpdate.length; j += 100) {
                    chunks.push(variantsToUpdate.slice(j, j + 100));
                }
                for (const chunk of chunks) {
                    await bulkUpdateVariants(productId, chunk);
                }
                console.log(`   ✔️ Updated ${variantsToUpdate.length} existing variants.`);
            }

            await new Promise(resolve => setTimeout(resolve, 800));
        }

        console.log('\\n🎉 Full CSV Sync Complete!');
    });
