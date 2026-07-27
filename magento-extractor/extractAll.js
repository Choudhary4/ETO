require('dotenv').config();
const { execSync } = require('child_process');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;
const CSV_FILE = '/Users/saurabhkuntal/Downloads/Zoho Books Items - Shopify (1) (1)(in) (3).csv';
const OUTPUT_FILE = path.join(__dirname, 'magento_options.json');

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

async function getUniqueSkus() {
    return new Promise((resolve, reject) => {
        const skus = new Set();
        fs.createReadStream(CSV_FILE)
            .pipe(csv())
            .on('data', (row) => {
                if (row['Handle']) {
                    // Try to guess the Magento base SKU from the Handle
                    // E.g. "Craftsman 1 Lite" -> "CRAFTSMAN 1 LITE"
                    // E.g. "Seattle" -> "SEATTLE"
                    skus.add(row['Handle'].toUpperCase().trim());
                }
            })
            .on('end', () => {
                resolve(Array.from(skus));
            })
            .on('error', reject);
    });
}

function extractValue(val) {
    if (!val) return val;
    return typeof val === 'object' ? val._ : val;
}

async function runExtraction() {
    console.log('🔄 Starting Batch Extraction...');

    const baseSkus = await getUniqueSkus();
    console.log(`📋 Found ${baseSkus.length} unique base SKUs in CSV.`);

    let allOptionsData = {};
    if (fs.existsSync(OUTPUT_FILE)) {
        allOptionsData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
        console.log(`📦 Loaded ${Object.keys(allOptionsData).length} already extracted SKUs to resume.`);
    }

    // Login
    console.log(`📡 Connecting to Magento...`);
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginRaw = await curlSoap(loginXml);
    const loginResult = await parser.parseStringPromise(loginRaw);

    if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.error(`❌ API Login Error: ${loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
        return;
    }

    const sessionIdRaw = loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn'];
    const sessionId = extractValue(sessionIdRaw);
    console.log(`✅ Login Successful! Session ID: ${sessionId}`);

    // Process each SKU
    for (let i = 0; i < baseSkus.length; i++) {
        const sku = baseSkus[i];

        if (allOptionsData[sku]) {
            console.log(`⏭️  Skipping ${sku} (already extracted)`);
            continue;
        }

        console.log(`\n[${i + 1}/${baseSkus.length}] 🔍 Fetching SKUs: ${sku}`);

        // Let's try to get custom options directly. If it fails, product might not exist or has no options.
        const optionsArgs = `<productId>${sku}</productId><store></store>`;
        const optionsXml = buildSoapEnvelope('catalogProductCustomOptionList', sessionId, optionsArgs);

        try {
            const optionsRaw = await curlSoap(optionsXml);
            const optionsResult = await parser.parseStringPromise(optionsRaw);

            if (optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                const errStr = optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring'];
                console.log(`   ❌ Skipped (No options or Product not found): ${errStr}`);
                allOptionsData[sku] = { error: errStr }; // Mark as attempted
            } else {
                const optionsDataResponse = optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductCustomOptionListResponse'];
                const optionsList = optionsDataResponse.result && optionsDataResponse.result.item ?
                    (Array.isArray(optionsDataResponse.result.item) ? optionsDataResponse.result.item : [optionsDataResponse.result.item]) : [];

                console.log(`   ✅ Found ${optionsList.length} options. Fetching values...`);

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

                    // Fetch values for dropdown/radio etc
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
                console.log(`   💾 Saved ${productOptions.length} mapped options.`);
            }

        } catch (e) {
            console.error(`   ⚠️ Error processing SKU ${sku}: ${e.message}`);
        }

        // Save progress occasionally
        if (i % 10 === 0) {
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allOptionsData, null, 2));
        }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allOptionsData, null, 2));
    console.log(`\n🎉 Extraction Complete! Data saved to magento_options.json`);

    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('🔒 Session Closed.');
}

runExtraction();
