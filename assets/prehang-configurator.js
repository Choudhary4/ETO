
const prehangState = { answers: {} };

// Read metafield JSON from <script id="product-config" type="application/json">...</script>
const productConfigEl = document.getElementById("product-config");
const productConfig = productConfigEl ? JSON.parse(productConfigEl.textContent) : {};

document.addEventListener("DOMContentLoaded", () => {
  
  const species = productConfig.species || "";

  // Mount point for the wizard
  const mount = document.getElementById("door-config-question");
  if (!mount) return;

  let currentStep = 0;
  const steps = [];

  // Map: step index -> which input names belong to that step (so we can reset UI)
  const stepInputNames = {
    0: ["configure"],
    1: ["door_configuration"],
    2: ["door_type"]
  };

  // Map: step index -> which answer keys are stored for that step
  const stepAnswerKeys = {
    0: ["configure"],
    1: ["door_configuration"],
    2: ["door_type"]
  };

  /* -------------------------
     Helpers to reset downstream
  -------------------------- */
  function resetStepUI(stepIndex) {
    const stepEl = steps[stepIndex];
    if (!stepEl) return;

    const names = stepInputNames[stepIndex] || [];
    names.forEach((name) => {
      stepEl.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
        if (input.type === "radio" || input.type === "checkbox") input.checked = false;
      });
      stepEl.querySelectorAll(`select[name="${name}"]`).forEach((sel) => {
        sel.selectedIndex = 0;
      });
    });
  }

  function clearStepAnswers(stepIndex) {
    const keys = stepAnswerKeys[stepIndex] || [];
    keys.forEach((k) => delete prehangState.answers[k]);
  }
  // Clear everything after the given step index (both state + UI)
  function clearDownstream(fromStepIndex) {
    for (let i = fromStepIndex + 1; i < steps.length; i++) {
      clearStepAnswers(i);
      resetStepUI(i);
    }
  }

  /* -------------------------
     Step visibility
  -------------------------- */
  function showStep(index) {
    steps.forEach((step, i) => {
      step.style.display = i === index ? "block" : "none";
    });
    currentStep = index;
  }

  /* -------------------------
     Validation
  -------------------------- */
  function isStepAnswered(stepIndex) {
    if (stepIndex === 0) return prehangState.answers.configure === "Yes";
    if (stepIndex === 1) return !!prehangState.answers.door_configuration;
    if (stepIndex === 2) return !!prehangState.answers.door_type;
    return true;
  }

  function shouldAddPrehang() {
    return (
      prehangState.answers.configure === "Yes" &&
      !!prehangState.answers.door_configuration &&
      !!prehangState.answers.door_type
    );
  }

  /* -------------------------
     Auto-advance
  -------------------------- */
  function autoAdvance(stepIndex) {
    if (stepIndex >= steps.length - 1) return; // last step
    if (!isStepAnswered(stepIndex)) return;
    showStep(stepIndex + 1);
  }

  /* -------------------------
     Navigation builder
  -------------------------- */
  function createStepNav(stepIndex) {
    const nav = document.createElement("div");
    nav.style.marginTop = "16px";
    nav.style.display = "flex";
    nav.style.gap = "8px";

    // Back (not first)
    if (stepIndex > 0) {
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "Back";
      back.onclick = () => showStep(stepIndex - 1);
      nav.appendChild(back);
    }

    // Next (not last)
    if (stepIndex < steps.length - 1) {
      const next = document.createElement("button");
      next.type = "button";
      next.textContent = "Next";
      next.onclick = () => {
        if (!isStepAnswered(stepIndex)) {
          alert("Please answer this question before continuing.");
          return;
        }
        showStep(stepIndex + 1);
      };
      nav.appendChild(next);
    }

    return nav;
  }

  /* -------------------------
     Mount steps + nav
     - Last step = ONLY Back
  -------------------------- */
  steps.forEach((step, index) => {
    if (index === steps.length - 1) {
      const nav = document.createElement("div");
      nav.style.marginTop = "16px";
      nav.style.display = "flex";
      nav.style.gap = "8px";

      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "Back";
      back.onclick = () => showStep(index - 1);
      nav.appendChild(back);

      step.appendChild(nav);
    } else {
      step.appendChild(createStepNav(index));
    }

    mount.appendChild(step);
  });

  showStep(0);

  /* -------------------------
     Pricing + quantity
  -------------------------- */
  function calculatePrehangPriceCents() {
    // SAMPLE PRICING (replace with your real logic)
    let cents = 0;

    // Base
    cents += 10000; // $100 base

    // Door configuration
    if (prehangState.answers.door_configuration === "Double Door") cents += 5000; // +$50

    // Door type
    if (prehangState.answers.door_type === "Exterior") cents += 2500; // +$25

    // Species example (from metafield)
    if (species === "Mahogany") cents += 1500; // +$15

    return cents;
  }

  function getSelectedQuantity() {
    const qtyInput =
      document.querySelector('product-form form input[name="quantity"]') ||
      document.querySelector('form[action^="/cart/add"] input[name="quantity"]') ||
      document.querySelector('input[name="quantity"]');

    if (!qtyInput) return 1;

    const value = parseInt(qtyInput.value, 10);
    return isNaN(value) || value < 1 ? 1 : value;
  }

  /* -------------------------
     Find the main product form (Dawn-safe)
  -------------------------- */
  function getMainProductForm() {
    const pf = document.querySelector("product-form form");
    if (pf) return pf;

    return document.querySelector('form[action^="/cart/add"]');
  }

  /* -------------------------
     Add prehang service
     IMPORTANT: Adds unique _config_id so items never merge
  -------------------------- */
  async function addPrehangToCart(uniqueKey) {
    const priceCents = calculatePrehangPriceCents();
    const qty = getSelectedQuantity();

    const properties = {
      "Door configuration": prehangState.answers.door_configuration || "",
      "Door type": prehangState.answers.door_type || "",
      "Species": species || "",
      "Calculated prehang price": `$${(priceCents / 100).toFixed(2)}`,
      "_config_id": uniqueKey // prevents grouping
    };

    const PREHANG_SERVICE_VARIANT_ID = 45684370899084; // your prehang service variant id

    const res = await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            id: PREHANG_SERVICE_VARIANT_ID,
            quantity: qty,
            properties
          }
        ]
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Prehang add error:", err);
      throw new Error(err.description || "Could not add prehang service to cart.");
    }
  }

  /* =========================
     STEP 1: Configure?
  ========================== */
  const step1 = document.createElement("div");
  step1.innerHTML = `
    <h4>Do you want to configure this door?</h4>
    <label><input type="radio" name="configure" value="Yes"> Yes</label><br>
    <label><input type="radio" name="configure" value="No"> No</label>
  `;
  step1.addEventListener("change", (e) => {
    if (e.target.name === "configure") {
      prehangState.answers.configure = e.target.value;
      clearDownstream(0);
      autoAdvance(0);
    }
  });
  steps.push(step1);

  /* =========================
     STEP 2: Door Configuration
  ========================== */
  const step2 = document.createElement("div");
  step2.innerHTML = `
    <h4>Door Configuration</h4>
    <label><input type="radio" name="door_configuration" value="Single Door"> Single Door</label><br>
    <label><input type="radio" name="door_configuration" value="Double Door"> Double Door</label>
  `;
  step2.addEventListener("change", (e) => {
    if (e.target.name === "door_configuration") {
      prehangState.answers.door_configuration = e.target.value;
      clearDownstream(1);
      autoAdvance(1);
    }
  });
  steps.push(step2);

  /* =========================
     STEP 3: Door Type
  ========================== */
  const step3 = document.createElement("div");
  step3.innerHTML = `
    <h4>Door Type</h4>
    <label><input type="radio" name="door_type" value="Interior"> Interior</label><br>
    <label><input type="radio" name="door_type" value="Exterior"> Exterior</label>
  `;
  step3.addEventListener("change", (e) => {
    if (e.target.name === "door_type") {
      prehangState.answers.door_type = e.target.value;
    }
  });
  steps.push(step3);



  /* -------------------------
     HOOK MAIN ADD TO CART
     - If configured: add MAIN door first, then prehang
     - Adds a shared _config_id property to BOTH items so they pair and never merge
  -------------------------- */
  (function hookMainAddToCart() {
    const form = getMainProductForm();
    if (!form) {
      console.warn("Prehang hook: main product form not found.");
      return;
    }

    const addBtn =
      form.querySelector('[type="submit"][name="add"]') ||
      form.querySelector('[type="submit"]');

    if (!addBtn) {
      console.warn("Prehang hook: submit button not found.");
      return;
    }

    if (addBtn.dataset.prehangHooked === "1") return;
    addBtn.dataset.prehangHooked = "1";

    addBtn.addEventListener("click", async (e) => {
      // If they didn't configure, let Shopify handle it normally
      if (!shouldAddPrehang()) return;

      // Must be fully answered
      if (!isStepAnswered(2)) {
        e.preventDefault();
        e.stopPropagation();
        alert("Please complete the configuration first.");
        return;
      }

      // We handle add-to-cart flow
      e.preventDefault();
      e.stopPropagation();

      addBtn.disabled = true;

      const uniqueKey = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      try {
        // 1) Add PREHANG FIRST (same _config_id)
        await addPrehangToCart(uniqueKey);
        // 2) Add MAIN product (door) FIRST
        const fd = new FormData(form);

        const variantId = fd.get("id");
        if (!variantId) {
          alert("Please select a variant first.");
          return;
        }

        // Make main door line unique too (prevents merging)
        fd.append("properties[_config_id]", uniqueKey);

        // Optional: also store the config on the door item
        // fd.append("properties[Door configuration]", prehangState.answers.door_configuration || "");
        fd.append("properties[Door type]", prehangState.answers.door_type || "");
        fd.append("properties[Species]", species || "");

        const mainRes = await fetch("/cart/add.js", {
          method: "POST",
          body: fd
        });

        if (!mainRes.ok) {
          const err = await mainRes.json().catch(() => ({}));
          console.error("Main add error:", err);
          alert(err.description || "Could not add the main product to cart.");
          return;
        }

        

        // 3) Go to cart
        window.location.href = "/cart";
      } catch (err) {
        console.error(err);
        alert(err.message || "Something went wrong adding items to cart.");
      } finally {
        addBtn.disabled = false;
      }
    });
  })();
});
