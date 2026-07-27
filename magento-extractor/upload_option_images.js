require('dotenv').config();
const fs = require('fs');
const https = require('https');
const path = require('path');

const SHOPIFY_STORE = 'etodoorscorp.myshopify.com';
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const GRAPHQL_URL = `https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`;

// Images from Magento that need uploading
// These are the ones NOT already on Shopify CDN
const IMAGES_TO_UPLOAD = [
    { filename: 'Gluechip_v2.png', url: 'https://www.etodoors.com/media/customoptions/40/10462/3/GLUE_CHIP.png' },
    { filename: 'SL_MonteCarlo.jpg', url: 'https://www.etodoors.com/media/customoptions/64/10561/3/FD1L-MonteCarloL.jpg' },
    { filename: 'SL_FD1LPB_Clear.jpg', url: 'https://www.etodoors.com/media/customoptions/65/10561/1/FD1LPB-Clear.jpg' },
    { filename: 'SL_FD3LPB_Clear.jpg', url: 'https://www.etodoors.com/media/customoptions/65/10561/2/FD3LPB-Clear.jpg' },
    { filename: 'SL_FD5LPB_Clear.jpg', url: 'https://www.etodoors.com/media/customoptions/65/10561/3/FD5LPB-Clear.jpg' },
    { filename: 'SL_Tuscany.jpg', url: 'https://www.etodoors.com/media/customoptions/63/10561/3/TUSCANY.jpg' },
];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function graphqlRequest(query, variables = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ query, variables });
        const url = new URL(GRAPHQL_URL);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': SHOPIFY_TOKEN,
                'Content-Length': Buffer.byteLength(data)
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error('JSON parse error: ' + body.substring(0, 200))); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function uploadViaURL(imageUrl, filename) {
    console.log(`  📤 Uploading ${filename} from ${imageUrl}`);
    
    const mutation = `mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
            files {
                ... on MediaImage {
                    id
                    image {
                        url
                    }
                }
                ... on GenericFile {
                    id
                    url
                }
            }
            userErrors {
                field
                message
            }
        }
    }`;

    const variables = {
        files: [{
            alt: filename.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
            contentType: "IMAGE",
            originalSource: imageUrl
        }]
    };

    const result = await graphqlRequest(mutation, variables);
    
    if (result.errors) {
        console.error(`  ❌ GraphQL errors:`, result.errors);
        return null;
    }
    
    const fileData = result.data?.fileCreate;
    if (fileData?.userErrors?.length > 0) {
        console.error(`  ❌ User errors:`, fileData.userErrors);
        return null;
    }

    console.log(`  ✅ Upload initiated for ${filename}`);
    return fileData?.files?.[0];
}

async function run() {
    console.log('🚀 Starting Shopify Image Upload...\n');

    if (!SHOPIFY_TOKEN) {
        console.error('❌ Missing SHOPIFY_ACCESS_TOKEN in .env');
        return;
    }

    const results = {};

    for (const img of IMAGES_TO_UPLOAD) {
        try {
            const result = await uploadViaURL(img.url, img.filename);
            results[img.filename] = result;
            await delay(1000); // Rate limit
        } catch (e) {
            console.error(`  ❌ Error uploading ${img.filename}: ${e.message}`);
            results[img.filename] = { error: e.message };
        }
    }

    // Wait a bit for processing, then query the files to get CDN URLs
    console.log('\n⏳ Waiting 10s for Shopify to process uploads...');
    await delay(10000);

    // Query all uploaded files
    console.log('\n🔍 Fetching uploaded file URLs...');
    const query = `{
        files(first: 50, sortKey: CREATED_AT, reverse: true, query: "media_type:IMAGE") {
            edges {
                node {
                    ... on MediaImage {
                        id
                        image {
                            url
                            originalSrc
                        }
                        alt
                    }
                }
            }
        }
    }`;
    
    const filesResult = await graphqlRequest(query);
    const uploadedFiles = {};
    
    if (filesResult.data?.files?.edges) {
        filesResult.data.files.edges.forEach(edge => {
            const node = edge.node;
            if (node.image?.url) {
                const alt = node.alt || '';
                uploadedFiles[alt] = node.image.url;
            }
        });
    }

    console.log('\n📋 Upload Results:');
    console.log(JSON.stringify(uploadedFiles, null, 2));
    
    fs.writeFileSync('uploaded_shopify_urls.json', JSON.stringify(uploadedFiles, null, 2));
    console.log('\n💾 Saved to uploaded_shopify_urls.json');
    console.log('🎉 Done!');
}

run().catch(e => console.error('🔥', e.message));
