export default {
  async fetch(request, env, ctx) {
    // Only accept POST requests from Shopify
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      // 1. Parse the incoming request from Shopify
      const body = await request.json();
      const rateRequest = body.rate;

      if (!rateRequest) {
        return new Response("Invalid request", { status: 400 });
      }

      const destination = rateRequest.destination;
      const items = rateRequest.items;

      // Extract ZIP and State
      const zipcode = destination.postal_code;
      const statecode = destination.province; // 2-letter state code (e.g. CA, NY)

      // 2. Calculate prehangcount, slabcount, o96
      let prehangcount = 0;
      let slabcount = 0;
      let o96 = false;

      for (const item of items) {
        // Ignore dummy $1 add-on items (used for custom option pricing)
        // We assume any real door costs more than $20 (2000 cents)
        if (item.price < 2000) {
          continue;
        }

        const itemName = item.name.toLowerCase();
        let isPrehung = false;

        // Check if name implies pre-hung
        if (itemName.includes('prehung') || itemName.includes('pre-hung')) {
          isPrehung = true;
        }

        // Check if item properties indicate pre-hanging (often added by option apps)
        if (item.properties) {
          const propsString = JSON.stringify(item.properties).toLowerCase();
          if (propsString.includes('pre hanging') || propsString.includes('pre-hanging') || propsString.includes('prehung')) {
            // Check if the value is not "no" or "none" just in case
            if (!propsString.includes('pre hanging: no') && !propsString.includes('pre hanging: none')) {
               isPrehung = true;
            }
          }
        }

        if (isPrehung) {
          prehangcount += item.quantity;
        } else {
          slabcount += item.quantity;
        }

        // Check for Oversized (Over 96 inches). Common sizes like 108" or 120"
        if (itemName.includes('108"') || itemName.includes('120"')) {
          o96 = true;
        } else if (item.properties) {
          // Also check properties for the size
          const propsString = JSON.stringify(item.properties);
          if (propsString.includes('108"') || propsString.includes('120"')) {
            o96 = true;
          }
        }
      }

      // 3. Prepare parameters for Zoho API
      const zohoParams = new URLSearchParams({
        publickey: env.ZOHO_PUBLIC_KEY, // Stored securely in Cloudflare Environment Variables
        prehangcount: prehangcount.toString(),
        slabcount: slabcount.toString(),
        zipcode: zipcode || "",
        statecode: statecode || "",
        o96: o96.toString()
      });

      const zohoUrl = `https://www.zohoapis.com/creator/custom/etodoors/calc_shipping_fee?${zohoParams.toString()}`;

      // 4. Call Zoho API
      const zohoResponse = await fetch(zohoUrl);
      const zohoData = await zohoResponse.json();

      // Zoho returns { "result": { "pallet_count": 1, "shipping_rate": 575 }, "code": 3000 }
      const shippingRate = zohoData?.result?.shipping_rate;

      // If Zoho fails to return a valid rate, return an empty array (no shipping available)
      if (typeof shippingRate !== 'number') {
        console.error("Invalid Zoho Response:", zohoData);
        return new Response(JSON.stringify({ rates: [] }), {
          headers: { "content-type": "application/json" }
        });
      }

      // 5. Format response for Shopify
      // Shopify expects the rate in cents (e.g., $575.00 -> 57500)
      const shopifyRateResponse = {
        rates: [
          {
            service_name: "ETO Delivery (Calculated)",
            service_code: "ETO_CUSTOM",
            total_price: Math.round(shippingRate * 100), // Convert dollars to cents
            currency: "USD",
            description: "Carrier calculated shipping based on your location and items."
          }
        ]
      };

      return new Response(JSON.stringify(shopifyRateResponse), {
        headers: { "content-type": "application/json" }
      });

    } catch (error) {
      console.error("Worker Error:", error);
      // Return empty rates on error to prevent checkout crashes
      return new Response(JSON.stringify({ rates: [] }), {
        headers: { "content-type": "application/json" }
      });
    }
  }
};
