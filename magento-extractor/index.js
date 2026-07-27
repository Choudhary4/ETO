require('dotenv').config();
const { execSync } = require('child_process');
const xml2js = require('xml2js');
const fs = require('fs');

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;

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
    // Escape single quotes for bash
    const safeXml = xmlString.replace(/'/g, "'\\''");
    // Using --max-time 120 to allow for Magento WSDL or heavy queries to return
    const cmd = `curl -s -X POST "${SOAP_URL}" -H "Content-Type: text/xml" -H "User-Agent: curl/8.7.1" --max-time 120 -d '${safeXml}'`;

    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 }); // 50MB buffer
    } catch (e) {
        throw new Error('Curl command failed: ' + e.message);
    }
}

async function testMagentoConnection() {
    console.log('🔄 Starting Magento API Test (using reliable curl HTTP/2)...');

    if (!API_USER || !API_KEY) {
        console.error('❌ ERROR: Missing credentials in .env');
        return;
    }

    try {
        console.log(`📡 Connecting to: ${SOAP_URL}`);
        const loginXml = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:Magento">
    <SOAP-ENV:Body>
        <ns1:login>
            <username>${API_USER}</username>
            <apiKey>${API_KEY}</apiKey>
        </ns1:login>
    </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

        const loginRaw = await curlSoap(loginXml);

        const parser = new xml2js.Parser({ explicitArray: false });
        const loginResult = await parser.parseStringPromise(loginRaw);

        if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
            const faultMessage = loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring'];
            console.error(`❌ API Login Error: ${faultMessage}`);
            console.error(`Please check if the Magento API username and password ('apiKey') in .env are correct!`);
            return;
        }

        let sessionIdRaw = loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn'];
        const sessionId = typeof sessionIdRaw === 'object' ? sessionIdRaw._ : sessionIdRaw;
        console.log(`✅ Login Successful! Session ID: ${sessionId}`);

        // --- STEP 2: Product Info ---
        const testSku = 'HADLEY';
        console.log(`\n🔍 Fetching Product Info for SKU: ${testSku}`);

        const infoArgs = `<productId>${testSku}</productId><identifierType>sku</identifierType>`;
        const infoXml = buildSoapEnvelope('catalogProductInfo', sessionId, infoArgs);

        const infoRaw = await curlSoap(infoXml);
        const infoResult = await parser.parseStringPromise(infoRaw);

        if (infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
            console.error(`❌ Permission Error: ` + infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']);
        } else {
            const productData = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse']['info'];
            const title = typeof productData.name === 'object' ? productData.name._ : productData.name;
            console.log(`✅ Success! Product Title: ${title}`);
        }

        // --- STEP 3: Custom Options ---
        console.log(`\n🔍 Fetching Custom Options for SKU: ${testSku}`);
        const optionsArgs = `<productId>${testSku}</productId><store></store>`;
        const optionsXml = buildSoapEnvelope('catalogProductCustomOptionList', sessionId, optionsArgs);

        const optionsRaw = await curlSoap(optionsXml);
        const optionsResult = await parser.parseStringPromise(optionsRaw);

        if (optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
            console.error(`❌ Custom Options Error: ` + optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']);
        } else {
            const optionsData = optionsResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductCustomOptionListResponse'];
            const optionsList = optionsData.result && optionsData.result.item ? (Array.isArray(optionsData.result.item) ? optionsData.result.item : [optionsData.result.item]) : [];
            console.log(`✅ Successfully fetched Custom Options! Found ${optionsList.length} options.`);
            // console.log(JSON.stringify(optionsData, null, 2));

            // --- STEP 4: Fetch Values for the first option ---
            if (optionsList.length > 0) {
                const firstOption = optionsList[0];
                const optionIdRaw = firstOption.option_id;
                const optionId = typeof optionIdRaw === 'object' ? optionIdRaw._ : optionIdRaw;
                const optionTitle = typeof firstOption.title === 'object' ? firstOption.title._ : firstOption.title;

                console.log(`\n🔍 Fetching Values & Prices for Option: ${optionTitle} (ID: ${optionId})`);

                const valueArgs = `<optionId>${optionId}</optionId><store></store>`;
                const valueXml = buildSoapEnvelope('catalogProductCustomOptionValueList', sessionId, valueArgs);
                const valueRaw = await curlSoap(valueXml);
                const valueResult = await parser.parseStringPromise(valueRaw);

                if (valueResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
                    console.error(`❌ Option Values Error: ` + valueResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']);
                } else {
                    const valueData = valueResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductCustomOptionValueListResponse'];
                    console.log(`✅ Success! Fetched choices and prices:`);
                    console.log(JSON.stringify(valueData.result, null, 2));
                }
            }
        }

        await curlSoap(buildSoapEnvelope('endSession', sessionId));
        console.log('\n🔒 Session Closed.');

    } catch (error) {
        console.error('🔥 Failed:', error.message);
    }
}

testMagentoConnection();
