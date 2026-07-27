require('dotenv').config();
const { execSync } = require('child_process');
const xml2js = require('xml2js');

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
    const safeXml = xmlString.replace(/'/g, "'\\''");
    const cmd = `curl -s -X POST "${SOAP_URL}" -H "Content-Type: text/xml" -H "User-Agent: curl/8.7.1" --max-time 30 -d '${safeXml}'`;
    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
    } catch (e) {
        throw new Error('Curl command failed: ' + e.message);
    }
}

const parser = new xml2js.Parser({ explicitArray: false });

async function debugProductInfo(sku) {
    console.log(`📡 Connecting to Magento...`);
    const loginXml = buildSoapEnvelope('login', '', `<username>${API_USER}</username><apiKey>${API_KEY}</apiKey>`);
    const loginRaw = await curlSoap(loginXml);
    const loginResult = await parser.parseStringPromise(loginRaw);

    if (loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.error(`❌ API Login Error: ${loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
        return;
    }

    const sessionIdRaw = loginResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:loginResponse']['loginReturn'];
    const sessionId = typeof sessionIdRaw === 'object' ? sessionIdRaw._ : sessionIdRaw;
    console.log(`✅ Login Successful! Session ID: ${sessionId}`);

    console.log(`\n🔍 Fetching Data for SKU: ${sku}`);
    // Request additional attributes to see if lead_time or overview is stored differently
    const infoArgs = `<productId>${sku}</productId><identifierType>sku</identifierType><attributes><additional_attributes><item>specification</item><item>custom4_contents</item><item>description</item><item>short_description</item><item>overview</item><item>lead_time</item></additional_attributes></attributes>`;
    const infoXml = buildSoapEnvelope('catalogProductInfo', sessionId, infoArgs);
    const infoRaw = await curlSoap(infoXml);
    const infoResult = await parser.parseStringPromise(infoRaw);

    if (infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']) {
        console.log(`❌ Error: ${infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['SOAP-ENV:Fault']['faultstring']}`);
    } else {
        const infoResponse = infoResult['SOAP-ENV:Envelope']['SOAP-ENV:Body']['ns1:catalogProductInfoResponse']['info'];
        console.log("------------------- FULL PRODUCT INFO RESPONSE WITH ADDITIONAL ATTRIBUTES -------------------");
        console.log(JSON.stringify(infoResponse, null, 2));
        console.log("------------------------------------------------------------------");
    }

    await curlSoap(buildSoapEnvelope('endSession', sessionId));
    console.log('🔒 Session Closed.');
}

debugProductInfo('RIPON');
