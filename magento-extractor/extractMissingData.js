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

const OPTIONS_FILE = path.join(__dirname, 'magento_options.json');
const FORMATTED_OPTIONS_FILE = path.join(__dirname, 'shopify_ready_options.json');
const TABS_OUTPUT_FILE = path.join(__dirname, 'magento_tabs_data.json');

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

// Check if a specific value exists deeply in a nested object based on keys
function findAttributeValue(attributesKeyArr, attrCode) {
    if (!attributesKeyArr || !Array.isArray(attributesKeyArr)) return null;
    for (const attr of attributesKeyArr) {
        if (extractValue(attr.key) === attrCode) {
            return extractValue(attr.value);
        }
    }
    return null;
}

async function formatOptionsAndSave(rawOptionsData) {
    const formattedData = {};
    for (const [sku, options] of Object.entries(rawOptionsData)) {
        if (options && !options.error && Array.isArray(options) && options.length > 0) {
            formattedData[sku] = options.map(opt => ({
                title: opt.title,
                type: opt.type,
                required: opt.is_require,
                order: opt.sort_order,
                values: opt.values ? opt.values.map(val => {
                    let valTitle = typeof val.title === 'string' ? val.title : (val.title ? String(val.title) : '');
                    return {
                        title: valTitle.replace(/\\s*=\\s*\\$\\d+(\\.\\d+)?\\s*/g, '').trim(),
                        price: parseFloat(val.price || 0),
                        price_type: val.price_type,
                        order: val.sort_order
                    };
                }).sort((a, b) => a.order - b.order) : []
            })).sort((a, b) => a.order - b.order);
        }
    }
    fs.writeFileSync(FORMATTED_OPTIONS_FILE, JSON.stringify(formattedData, null, 2));
}

async function runExtraction() {
    console.log('🔄 Starting Extraction for Missing Options & All Tabs Data...');

    const baseSkus = await getUniqueSkus();
    console.log(`📋 Found ${baseSkus.length} unique base SKUs in CSV.`);

    let allOptionsData = {};
    let alreadyExtractedOptions = [];
    if (fs.existsSync(OPTIONS_FILE)) {
        allOptionsData = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
        alreadyExtractedOptions = Object.keys(allOptionsData).filter(k => Array.isArray(allOptionsData[k]));
        console.log(`📦 Loaded ${alreadyExtractedOptions.length} already extracted Custom Options.`);
    }

    let allTabsData = {};
    if (fs.existsSync(TABS_OUTPUT_FILE)) {
        allTabsData = JSON.parse(fs.readFileSync(TABS_OUTPUT_FILE, 'utf8'));
        console.log(`📦 Loaded ${Object.keys(allTabsData).length} already extracted Tabs Data.`);
    }

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

    for (let i = 0; i < baseSkus.length; i++) {
        const sku = baseSkus[i];
        console.log(`\n[${i + 1}/${baseSkus.length}] 🔍 Fetching Data for SKU: ${sku}`);

        // 1. EXTRACT TABS DATA (Always perform for all SKUs, even if already extracted, to fix the HTML issue)
        try {
            const infoArgs = `<productId>${sku}</productId><identifierType>sku</identifierType><attributes><additional_attributes><item>specification</item><item>custom4_contents</item><item>description</item><item>overview</item><item>lead_time</item></additional_attributes></attributes>`;
            const infoXml = buildSoapEnvelope('catalogProductInfo', sessionId, infoArgs);
            const infoRaw = await curlSoap(infoXml);
            const infoResult = await parser.parseStringPromise(infoRaw);

            if (infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                console.log(`   ❌ Tabs Data Error: ${infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
                allTabsData[sku] = { error: 'Not found' };
            } else {
                const infoResponse = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse']['info'];

                // To handle attributes in 'additional_attributes' node
                let additionalAttrs = infoResponse.additional_attributes && infoResponse.additional_attributes.item ?
                    (Array.isArray(infoResponse.additional_attributes.item) ? infoResponse.additional_attributes.item : [infoResponse.additional_attributes.item]) : [];

                // Priority: Explicit additional attribute > Default attribute
                let overview = findAttributeValue(additionalAttrs, 'overview') || findAttributeValue(additionalAttrs, 'description') || extractValue(infoResponse.description) || extractValue(infoResponse.overview);
                let spec = findAttributeValue(additionalAttrs, 'specification') || extractValue(infoResponse.specification);
                let lead = findAttributeValue(additionalAttrs, 'lead_time') || findAttributeValue(additionalAttrs, 'custom4_contents');

                allTabsData[sku] = {
                    overview: overview || '',
                    specification: spec || '',
                    lead_time: lead || ''
                };
                console.log(`   ✅ Extracted Tabs: Overview (${overview ? 'Y' : 'N'}), Spec (${spec ? 'Y' : 'N'}), Lead Time (${lead ? 'Y' : 'N'})`);
            }
        } catch (e) {
            console.error(`   ⚠️ Tabs Error processing SKU ${sku}: ${e.message}`);
        }

        // 2. EXTRACT CUSTOM OPTIONS (Only if NOT already extracted)
        const hasValidOptions = Array.isArray(allOptionsData[sku]) && allOptionsData[sku].length > 0;
        const hasNoOptionsMarked = allOptionsData[sku] && allOptionsData[sku].error;

        if (!hasValidOptions && !hasNoOptionsMarked) {
            console.log(`   🔍 Fetching missing Custom Options...`);
            const optionsArgs = `<productId>${sku}</productId><store></store>`;
            const optionsXml = buildSoapEnvelope('catalogProductCustomOptionList', sessionId, optionsArgs);

            try {
                const optionsRaw = await curlSoap(optionsXml);
                const optionsResult = await parser.parseStringPromise(optionsRaw);

                if (optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                    const errStr = optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring'];
                    console.log(`   ❌ Custom Options: ${errStr}`);
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
                console.error(`   ⚠️ Options Error processing SKU ${sku}: ${e.message}`);
            }
        } else {
            console.log(`   ⏭️ Skipped Custom Options (Already exists or marked as none)`);
        }

        // Save progress occasionally
        if (i % 10 === 0) {
            fs.writeFileSync(OPTIONS_FILE, JSON.stringify(allOptionsData, null, 2));
            fs.writeFileSync(TABS_OUTPUT_FILE, JSON.stringify(allTabsData, null, 2));
        }
    }

    fs.writeFileSync(OPTIONS_FILE, JSON.stringify(allOptionsData, null, 2));
    fs.writeFileSync(TABS_OUTPUT_FILE, JSON.stringify(allTabsData, null, 2));

    // Auto format the newly fetched options
    console.log(`\n🧹 Formatting all Custom Options into shopify_ready_options.json...`);
    await formatOptionsAndSave(allOptionsData);

    console.log(`\n🎉 Extraction Complete! Data saved to magento_options.json and magento_tabs_data.json`);

    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('🔒 Session Closed.');
}

runExtraction();
