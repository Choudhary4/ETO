require('dotenv').config();

const MAGENTO_URL = process.env.MAGENTO_URL || 'https://www.etodoors.com';
const API_USER = process.env.MAGENTO_API_USER;
const API_KEY = process.env.MAGENTO_API_KEY;
const SOAP_URL = `${MAGENTO_URL}/api/v2_soap/index/`;

async function testFetch() {
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

    try {
        console.log('Sending fetch request...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(SOAP_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8'
            },
            body: loginXml,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`Status: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log('Response length:', text.length);
        console.log('Preview:', text.substring(0, 500));

    } catch (error) {
        console.error('🔥 Error:', error.message);
    }
}

testFetch();
