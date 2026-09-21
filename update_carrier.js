const https = require('https');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const STORE_DOMAIN = "etodoorscorp.myshopify.com";

console.log("\n=== Update Carrier Service URL ===\n");

rl.question("1. Enter your Shopify Admin API Access Token (starts with shpat_): ", (token) => {
  if (!token.startsWith('shpat_')) {
    console.error("Error: Token must start with shpat_");
    rl.close();
    return;
  }

  rl.question("2. Enter your NEW Cloudflare Worker URL (e.g., https://eto-shipping-api...): ", (url) => {
    if (!url.startsWith('https://')) {
      console.error("Error: URL must start with https://");
      rl.close();
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    };

    // 1. Get existing carrier services
    console.log("\nFetching existing carrier services...");
    const getReq = https.request({
      hostname: STORE_DOMAIN,
      path: '/admin/api/2024-01/carrier_services.json',
      method: 'GET',
      headers: headers
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error("Failed to fetch carrier services:", data);
          rl.close();
          return;
        }

        const services = JSON.parse(data).carrier_services;
        const etoService = services.find(s => s.name === "ETO Doors Shipping" || s.callback_url.includes("workers.dev"));

        if (!etoService) {
          console.error("Could not find the ETO Doors Shipping carrier service. Did you delete it?");
          rl.close();
          return;
        }

        console.log(`Found Carrier Service ID: ${etoService.id}`);
        console.log(`Updating URL to: ${url}`);

        // 2. Update the carrier service
        const payload = JSON.stringify({
          carrier_service: {
            id: etoService.id,
            callback_url: url
          }
        });

        const putReq = https.request({
          hostname: STORE_DOMAIN,
          path: `/admin/api/2024-01/carrier_services/${etoService.id}.json`,
          method: 'PUT',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (putRes) => {
          let putData = '';
          putRes.on('data', (chunk) => putData += chunk);
          putRes.on('end', () => {
            if (putRes.statusCode === 200) {
              console.log("\n✅ SUCCESS! Carrier Service URL updated successfully.");
              console.log("New URL is now active: " + JSON.parse(putData).carrier_service.callback_url);
            } else {
              console.error("\n❌ ERROR: Failed to update.");
              console.error(putData);
            }
            rl.close();
          });
        });

        putReq.write(payload);
        putReq.end();
      });
    });

    getReq.on('error', (e) => {
      console.error("\n❌ Request failed:", e.message);
      rl.close();
    });

    getReq.end();
  });
});
