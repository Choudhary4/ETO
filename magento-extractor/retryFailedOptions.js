require('dotenv').config();
const { execSync } = require('child_process');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;

const OPTIONS_FILE = path.join(__dirname, 'magento_options.json');
const FORMATTED_OPTIONS_FILE = path.join(__dirname, 'shopify_ready_options.json');

function buildSoapEnvelope(action, sessionId, args = '') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:Magento">
    <SOAP-ENV:Body>
        <ns1:${action}>
            <sessionId>${sessionId}</sessionId>
            ${args}
        </ns1:${action}>
    </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

async function curlSoap(xmlString) {
    const safeXml = xmlString.replace(/'/g, "'\\''");
    const cmd = `curl -s -X POST "${SOAP_URL}" -H "Content-Type: text/xml" -H "User-Agent: curl/8.7.1" --max-time 30 -d '${safeXml}'`;
    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
    } catch (e) {
        throw new Error('Curl command failed: ' + e.message);
    }
}

const parser = new xml2js.Parser({ explicitArray: false });

function extractValue(val) {
    if (!val) return val;
    return typeof val === 'object' ? val._ : val;
}

async function run() {
    console.log('🔄 Retry Failed SKU Options Extraction');
    console.log('========================================\n');

    // 1. Load existing options and find failed SKUs
    const allOptionsData = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
    const failedSkus = Object.entries(allOptionsData)
        .filter(([sku, val]) => val && typeof val === 'object' && !Array.isArray(val) && val.error)
        .map(([sku]) => sku);

    console.log(`📋 Found ${failedSkus.length} failed SKUs to retry:`);
    failedSkus.forEach(s => console.log(`   - ${s}`));
    console.log('');

    if (failedSkus.length === 0) {
        console.log('✅ No failed SKUs to retry!');
        return;
    }

    // 2. Login to Magento
    console.log('📡 Connecting to Magento...');
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginRaw = await curlSoap(loginXml);
    const loginResult = await parser.parseStringPromise(loginRaw);

    if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.error(`❌ API Login Error: ${loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
        return;
    }

    const sessionId = extractValue(loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn']);
    console.log(`✅ Login Successful! Session: ${sessionId}\n`);

    let fixed = 0;
    let stillFailed = 0;

    // 3. For each failed SKU: resolve numeric ID via catalogProductInfo, then fetch options
    for (let i = 0; i < failedSkus.length; i++) {
        const sku = failedSkus[i];
        console.log(`\n[${i + 1}/${failedSkus.length}] 🔍 Retrying SKU: ${sku}`);

        try {
            // Step A: Resolve SKU → numeric product ID via catalogProductInfo
            const infoArgs = `<productId>${sku}</productId><identifierType>sku</identifierType>`;
            const infoXml = buildSoapEnvelope('catalogProductInfo', sessionId, infoArgs);
            const infoRaw = await curlSoap(infoXml);
            const infoResult = await parser.parseStringPromise(infoRaw);

            if (infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                const errStr = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring'];
                console.log(`   ❌ Product Info failed: ${errStr}`);
                console.log(`   → This product truly does not exist in Magento.`);
                stillFailed++;
                continue;
            }

            const infoResponse = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse']['info'];
            const numericProductId = extractValue(infoResponse.product_id);
            console.log(`   ✅ Resolved SKU "${sku}" → Magento Product ID: ${numericProductId}`);

            // Step B: Fetch custom options using the NUMERIC product ID
            const optionsArgs = `<productId>${numericProductId}</productId><store></store>`;
            const optionsXml = buildSoapEnvelope('catalogProductCustomOptionList', sessionId, optionsArgs);
            const optionsRaw = await curlSoap(optionsXml);
            const optionsResult = await parser.parseStringPromise(optionsRaw);

            if (optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                const errStr = optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring'];
                console.log(`   ❌ Custom Options failed even with numeric ID: ${errStr}`);
                allOptionsData[sku] = { error: errStr, numericId: numericProductId };
                stillFailed++;
                continue;
            }

            const optionsDataResponse = optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductCustomOptionListResponse'];
            const optionsList = optionsDataResponse.result && optionsDataResponse.result.item ?
                (Array.isArray(optionsDataResponse.result.item) ? optionsDataResponse.result.item : [optionsDataResponse.result.item]) : [];

            console.log(`   ✅ Found ${optionsList.length} custom options! Fetching values...`);

            const productOptions = [];

            for (const opt of optionsList) {
                const optId = extractValue(opt.option_id);
                const optTitle = extractValue(opt.title);
                const optType = extractValue(opt.type);
                const optIsRequire = extractValue(opt.is_require);
                const optSortOrder = extractValue(opt.sort_order);

                const parsedOption = {
                    id: optId,
                    title: optTitle,
                    type: optType,
                    is_require: optIsRequire === '1' || optIsRequire === 1,
                    sort_order: parseInt(optSortOrder || 0),
                    values: []
                };

                if (['drop_down', 'radio', 'checkbox', 'multiple'].includes(optType)) {
                    const valueArgs = `<optionId>${optId}</optionId><store></store>`;
                    const valueXml = buildSoapEnvelope('catalogProductCustomOptionValueList', sessionId, valueArgs);
                    const valueRaw = await curlSoap(valueXml);
                    const valueResult = await parser.parseStringPromise(valueRaw);

                    if (!valueResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                        const valueResponse = valueResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductCustomOptionValueListResponse'];
                        const valuesList = valueResponse.result && valueResponse.result.item ?
                            (Array.isArray(valueResponse.result.item) ? valueResponse.result.item : [valueResponse.result.item]) : [];

                        for (const v of valuesList) {
                            parsedOption.values.push({
                                value_id: extractValue(v.value_id),
                                title: extractValue(v.title),
                                price: parseFloat(extractValue(v.price) || 0),
                                price_type: extractValue(v.price_type),
                                sort_order: parseInt(extractValue(v.sort_order) || 0)
                            });
                        }
                    }
                }

                productOptions.push(parsedOption);
            }

            allOptionsData[sku] = productOptions;
            console.log(`   💾 Saved ${productOptions.length} options for ${sku}!`);
            fixed++;

        } catch (e) {
            console.error(`   ⚠️ Error processing SKU ${sku}: ${e.message}`);
            stillFailed++;
        }
    }

    // 4. Save updated options
    fs.writeFileSync(OPTIONS_FILE, JSON.stringify(allOptionsData, null, 2));
    console.log(`\n========================================`);
    console.log(`✅ Fixed: ${fixed} SKUs`);
    console.log(`❌ Still failed: ${stillFailed} SKUs`);
    console.log(`💾 Updated magento_options.json`);

    // 5. Also update shopify_ready_options.json
    console.log(`\n🧹 Updating shopify_ready_options.json...`);
    const formattedData = {};
    for (const [sku, options] of Object.entries(allOptionsData)) {
        if (options && !options.error && Array.isArray(options) && options.length > 0) {
            formattedData[sku] = options.map(opt => ({
                title: opt.title,
                type: opt.type,
                required: opt.is_require,
                order: opt.sort_order,
                values: opt.values ? opt.values.map(val => {
                    let valTitle = typeof val.title === 'string' ? val.title : (val.title ? String(val.title) : '');
                    return {
                        title: valTitle.replace(/\s*=\s*\$\d+(\.\d+)?\s*/g, '').trim(),
                        price: parseFloat(val.price || 0),
                        price_type: val.price_type,
                        order: val.sort_order
                    };
                }).sort((a, b) => a.order - b.order) : []
            })).sort((a, b) => a.order - b.order);
        }
    }
    fs.writeFileSync(FORMATTED_OPTIONS_FILE, JSON.stringify(formattedData, null, 2));
    console.log(`💾 Updated shopify_ready_options.json with ${Object.keys(formattedData).length} products.`);

    // 6. Close session
    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('🔒 Session Closed.');
}

run().catch(e => {
    console.error('💥 Fatal error:', e.message);
    console.error(e.stack);
});
