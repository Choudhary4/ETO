const https = require('https');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const STORE_DOMAIN = "etodoorscorp.myshopify.com";

console.log("\n=== ETO Doors Shipping - Carrier Service Registration ===\n");

rl.question("1. Enter your Shopify Admin API Access Token (starts with shpat_): ", (token) => {
  if (!token.startsWith('shpat_')) {
    console.error("Error: Token must start with shpat_");
    rl.close();
    return;
  }

  rl.question("2. Enter your Cloudflare Worker URL (e.g., https://proud-unit-b736.broad-cherry-a0ba.workers.dev): ", (url) => {
    if (!url.startsWith('https://')) {
      console.error("Error: URL must start with https://");
      rl.close();
      return;
    }

    const payload = JSON.stringify({
      carrier_service: {
        name: "ETO Doors Shipping",
        callback_url: url,
        service_discovery: true
      }
    });

    const options = {
      hostname: STORE_DOMAIN,
      path: '/admin/api/2024-01/carrier_services.json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    console.log("\nRegistering Carrier Service with Shopify...");

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 201) {
          console.log("\n✅ SUCCESS! Carrier Service has been registered.");
          console.log(JSON.parse(data));
          console.log("\nNext Steps: Go to Shopify Admin -> Settings -> Shipping and Delivery, and add 'ETO Doors Shipping' to your shipping zones.");
        } else {
          console.error(`\n❌ ERROR (${res.statusCode}): Failed to register.`);
          console.error(data);
          console.error("\nMake sure your Custom App has the 'write_shipping' permission!");
        }
        rl.close();
      });
    });

    req.on('error', (e) => {
      console.error("\n❌ Request failed:", e.message);
      rl.close();
    });

    req.write(payload);
    req.end();
  });
});
