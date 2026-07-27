require('dotenv').config();
const { execSync } = require('child_process');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;

const PRODUCT_CATALOG_FILE = path.join(__dirname, 'all_magento_products.json');
const OPTIONS_FILE = path.join(__dirname, 'magento_options.json');
const RESOLUTION_FILE = path.join(__dirname, 'resolved_magento_skus.json');

const defaultQueries = ['LOUVER', 'RITZ', 'RANCHO', 'LA PLAYA'];

function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildSoapEnvelope(action, sessionId, args = '') {
    const sessionTag = sessionId ? `<sessionId>${sessionId}</sessionId>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:Magento">
    <SOAP-ENV:Body>
        <ns1:${action}>
            ${sessionTag}
            ${args}
        </ns1:${action}>
    </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function curlSoap(xmlString) {
    const safeXml = xmlString.replace(/'/g, "'\\''");
    const cmd = `curl -s -X POST "${SOAP_URL}" -H "Content-Type: text/xml" -H "User-Agent: curl/8.7.1" --max-time 120 -d '${safeXml}'`;
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
}

function extractValue(val) {
    if (!val) return val;
    return typeof val === 'object' ? val._ : val;
}

function isHtmlResponse(raw) {
    const trimmed = String(raw || '').trimStart();
    return trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html') || trimmed.includes('Just a moment');
}

function scoreCandidate(query, product) {
    const normalizedQuery = normalize(query);
    const normalizedSku = normalize(product.sku);
    const normalizedName = normalize(product.name);

    if (!normalizedSku && !normalizedName) return -1;
    if (normalizedSku === normalizedQuery) return 1000;
    if (normalizedName === normalizedQuery) return 950;
    if (normalizedName.startsWith(normalizedQuery)) return 900;
    if (normalizedSku.startsWith(normalizedQuery)) return 850;
    if (normalizedName.includes(normalizedQuery)) return 800;
    if (normalizedSku.includes(normalizedQuery)) return 750;

    const queryParts = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (queryParts.length > 0) {
        const allNamePartsPresent = queryParts.every(part => String(product.name || '').toLowerCase().includes(part));
        if (allNamePartsPresent) return 700;
    }

    return -1;
}

function resolveProduct(query, allProducts) {
    const ranked = allProducts
        .map(product => ({ product, score: scoreCandidate(query, product) }))
        .filter(entry => entry.score >= 0)
        .sort((a, b) => b.score - a.score || Number(a.product.product_id) - Number(b.product.product_id));

    return ranked.length > 0 ? ranked[0].product : null;
}

async function parseSoap(rawXml, parser) {
    if (isHtmlResponse(rawXml)) {
        throw new Error('Received HTML/Cloudflare page instead of SOAP XML.');
    }
    return parser.parseStringPromise(rawXml);
}

async function fetchOptionsForProduct(sessionId, resolvedProduct, parser) {
    const infoXml = buildSoapEnvelope(
        'catalogProductInfo',
        sessionId,
        `<productId>${resolvedProduct.sku}</productId><identifierType>sku</identifierType>`
    );
    const infoResult = await parseSoap(curlSoap(infoXml), parser);
    const infoFault = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault'];
    if (infoFault) {
        throw new Error(infoFault.faultstring || 'catalogProductInfo failed');
    }

    const info = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse']['info'];
    const numericProductId = extractValue(info.product_id);

    const optionsXml = buildSoapEnvelope(
        'catalogProductCustomOptionList',
        sessionId,
        `<productId>${numericProductId}</productId><store></store>`
    );
    const optionsResult = await parseSoap(curlSoap(optionsXml), parser);
    const optionsFault = optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault'];
    if (optionsFault) {
        throw new Error(optionsFault.faultstring || 'catalogProductCustomOptionList failed');
    }

    const optionsResponse = optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductCustomOptionListResponse'];
    const optionsList = optionsResponse.result && optionsResponse.result.item
        ? (Array.isArray(optionsResponse.result.item) ? optionsResponse.result.item : [optionsResponse.result.item])
        : [];

    const productOptions = [];

    for (const option of optionsList) {
        const parsedOption = {
            id: extractValue(option.option_id),
            title: extractValue(option.title),
            type: extractValue(option.type),
            is_require: extractValue(option.is_require) === '1' || extractValue(option.is_require) === 1,
            sort_order: parseInt(extractValue(option.sort_order) || 0, 10),
            values: []
        };

        if (['drop_down', 'radio', 'checkbox', 'multiple'].includes(parsedOption.type)) {
            const valuesXml = buildSoapEnvelope(
                'catalogProductCustomOptionValueList',
                sessionId,
                `<optionId>${parsedOption.id}</optionId><store></store>`
            );
            const valueResult = await parseSoap(curlSoap(valuesXml), parser);
            const valueFault = valueResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault'];

            if (!valueFault) {
                const valueResponse = valueResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductCustomOptionValueListResponse'];
                const valuesList = valueResponse.result && valueResponse.result.item
                    ? (Array.isArray(valueResponse.result.item) ? valueResponse.result.item : [valueResponse.result.item])
                    : [];

                for (const value of valuesList) {
                    parsedOption.values.push({
                        value_id: extractValue(value.value_id),
                        title: extractValue(value.title),
                        price: parseFloat(extractValue(value.price) || 0),
                        price_type: extractValue(value.price_type),
                        sort_order: parseInt(extractValue(value.sort_order) || 0, 10)
                    });
                }
            }
        }

        productOptions.push(parsedOption);
    }

    return { numericProductId, productOptions };
}

async function run() {
    const requestedDoors = process.argv.slice(2);
    const queries = requestedDoors.length > 0 ? requestedDoors : defaultQueries;

    if (!API_USER || !API_KEY) {
        throw new Error('Missing Magento credentials in .env');
    }

    const allProducts = JSON.parse(fs.readFileSync(PRODUCT_CATALOG_FILE, 'utf8'));
    const optionsData = fs.existsSync(OPTIONS_FILE)
        ? JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'))
        : {};
    const resolutionData = fs.existsSync(RESOLUTION_FILE)
        ? JSON.parse(fs.readFileSync(RESOLUTION_FILE, 'utf8'))
        : {};

    console.log(`🔎 Resolving ${queries.length} requested doors against local Magento dump...`);
    const resolvedEntries = queries.map(query => {
        const product = resolveProduct(query, allProducts);
        return { query, product };
    });

    const unresolved = resolvedEntries.filter(entry => !entry.product);
    resolvedEntries
        .filter(entry => entry.product)
        .forEach(entry => {
            console.log(`   ✅ ${entry.query} -> ${entry.product.sku} (#${entry.product.product_id})`);
        });

    unresolved.forEach(entry => {
        console.log(`   ❌ Could not resolve ${entry.query}`);
    });

    if (resolvedEntries.every(entry => !entry.product)) {
        throw new Error('None of the requested doors could be resolved to Magento SKUs.');
    }

    const parser = new xml2js.Parser({ explicitArray: false });
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginResult = await parseSoap(curlSoap(loginXml), parser);
    const loginFault = loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault'];
    if (loginFault) {
        throw new Error(loginFault.faultstring || 'Magento login failed');
    }

    const sessionId = extractValue(loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn']);
    console.log(`🔐 Logged into Magento. Session: ${sessionId}`);

    try {
        for (const entry of resolvedEntries) {
            if (!entry.product) continue;

            console.log(`\n[Door] ${entry.query}`);
            console.log(`   SKU: ${entry.product.sku}`);
            console.log(`   Name: ${entry.product.name}`);

            const { numericProductId, productOptions } = await fetchOptionsForProduct(sessionId, entry.product, parser);

            optionsData[entry.query] = productOptions;
            optionsData[entry.product.sku] = productOptions;
            resolutionData[entry.query] = {
                resolved_sku: entry.product.sku,
                product_id: numericProductId,
                name: entry.product.name,
                extracted_at: new Date().toISOString()
            };

            console.log(`   ✅ Extracted ${productOptions.length} options`);
        }
    } finally {
        try {
            curlSoap(buildSoapEnvelope('endSession', sessionId));
        } catch (error) {
            console.log(`⚠️ Could not close session cleanly: ${error.message}`);
        }
    }

    fs.writeFileSync(OPTIONS_FILE, JSON.stringify(optionsData, null, 2));
    fs.writeFileSync(RESOLUTION_FILE, JSON.stringify(resolutionData, null, 2));

    console.log(`\n💾 Updated ${path.basename(OPTIONS_FILE)}`);
    console.log(`💾 Updated ${path.basename(RESOLUTION_FILE)}`);
}

run().catch(error => {
    console.error(`💥 ${error.message}`);
    process.exitCode = 1;
});
