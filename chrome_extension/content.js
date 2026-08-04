// JARVIS Career Copilot Content Script — AI Form Schema Classifier & DOM Injector

(function () {
  if (window.hasJarvisBadge) return;
  window.hasJarvisBadge = true;

  console.log("⚡ JARVIS Career Copilot active on page.");

  // Inject floating UI badge
  const badge = document.createElement("div");
  badge.id = "jarvis-copilot-badge";
  badge.innerHTML = `
    <div class="jarvis-badge-icon">J</div>
    <div style="font-size: 11px; font-weight: 700; color: #dfe2f3;">JARVIS Copilot</div>
    <button class="jarvis-btn-autofill" id="jarvis-autofill-trigger">⚡ AUTOFILL</button>
    <button class="jarvis-btn-save" id="jarvis-save-trigger">📌 SAVE</button>
  `;
  document.body.appendChild(badge);

  function getFieldTextContext(input) {
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const placeholder = (input.placeholder || "").toLowerCase();
    const aria = (input.getAttribute("aria-label") || "").toLowerCase();
    const title = (input.title || "").toLowerCase();
    
    let labelText = "";
    if (input.labels && input.labels.length) {
      labelText = Array.from(input.labels).map(l => l.innerText).join(" ").toLowerCase();
    }
    
    let parent = input.parentElement;
    let ancestorText = "";
    let depth = 0;
    while (parent && depth < 6) {
      ancestorText += " " + (parent.innerText || "").toLowerCase();
      if (parent.getAttribute("role") === "listitem" || parent.classList.contains("freebirdFormviewerComponentsQuestionBaseRoot")) {
        break;
      }
      parent = parent.parentElement;
      depth++;
    }

    return `${name} ${id} ${placeholder} ${aria} ${title} ${labelText} ${ancestorText}`;
  }

  function findInputs(labels, excludes = []) {
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    return inputs.filter(input => {
      const type = (input.type || "").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset", "radio", "checkbox"].includes(type)) return false;
      const context = getFieldTextContext(input);
      const hasMatch = labels.some(l => context.includes(l.toLowerCase()));
      if (!hasMatch) return false;
      if (excludes.some(ex => context.includes(ex.toLowerCase()))) return false;
      return true;
    });
  }

  function setInputValue(input, val) {
    if (!input || val == null || val === "") return false;
    try {
      input.focus();
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, val);
      } else {
        input.value = val;
      }
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter" }));
      input.blur();
      return true;
    } catch (e) {
      console.error("setInputValue error:", e);
      input.value = val;
      return false;
    }
  }

  function fillRadioGroup(questionKeywords, targetOptionText) {
    if (!targetOptionText) return false;
    let clicked = false;
    const containers = Array.from(document.querySelectorAll('div[role="listitem"], fieldset, .freebirdFormviewerComponentsQuestionBaseRoot, .geFormComponents, div.form-group, div.mb-4, div.py-3'));
    
    for (const container of containers) {
      const text = (container.innerText || "").toLowerCase();
      if (questionKeywords.some(k => text.includes(k.toLowerCase()))) {
        const options = Array.from(container.querySelectorAll('div[role="radio"], input[type="radio"], label, div.docssharedWizToggleLabeledContainer'));
        for (const opt of options) {
          const optText = (opt.innerText || opt.getAttribute("aria-label") || opt.value || opt.parentElement.innerText || "").toLowerCase();
          if (optText.includes(targetOptionText.toLowerCase()) || targetOptionText.toLowerCase().includes(optText)) {
            opt.focus();
            opt.click();
            opt.dispatchEvent(new Event("change", { bubbles: true }));
            clicked = true;
            break;
          }
        }
        if (clicked) break;
      }
    }
    return clicked;
  }

  // Extract Form Schema for AI Classifier
  function extractPageFormSchema() {
    const fields = [];
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    
    inputs.forEach((input, index) => {
      const type = (input.type || "").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset", "radio", "checkbox"].includes(type)) return;
      const context = getFieldTextContext(input).trim();
      if (!context || context.length < 3) return;
      
      const fieldId = `input_field_${index}`;
      input.setAttribute("data-jarvis-id", fieldId);
      fields.push({
        field_id: fieldId,
        question_context: context.slice(0, 250),
        type: type || "text",
      });
    });

    const containers = Array.from(document.querySelectorAll('div[role="listitem"], fieldset, .freebirdFormviewerComponentsQuestionBaseRoot, .geFormComponents, div.form-group'));
    containers.forEach((container, index) => {
      const text = (container.innerText || "").trim();
      if (!text || text.length < 5) return;
      
      const options = Array.from(container.querySelectorAll('div[role="radio"], input[type="radio"], label, div.docssharedWizToggleLabeledContainer'))
        .map(opt => (opt.innerText || opt.getAttribute("aria-label") || opt.value || "").trim())
        .filter(t => t.length > 0);
        
      if (options.length > 0) {
        const fieldId = `radio_group_${index}`;
        container.setAttribute("data-jarvis-id", fieldId);
        fields.push({
          field_id: fieldId,
          question_context: text.slice(0, 300),
          type: "radio_group",
          options: Array.from(new Set(options)).slice(0, 10),
        });
      }
    });

    return fields;
  }

  // 1-Click Autofill Handler
  document.getElementById("jarvis-autofill-trigger").addEventListener("click", () => {
    const btn = document.getElementById("jarvis-autofill-trigger");
    btn.innerText = "⏳ AI Reasoning…";

    chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (res) => {
      if (!res || !res.ok || !res.profile) {
        const errMsg = (res && res.error) ? res.error : "Network error / Backend unreachable";
        alert(`⚠️ Failed to fetch candidate profile from JARVIS backend: ${errMsg}`);
        btn.innerText = "⚡ AUTOFILL";
        return;
      }

      const p = res.profile;
      let filledCount = 0;

      // Stage 1: Local Heuristic Fast-Fill (zero-latency for standard fields)
      const fillGroup = (labels, val, excludes = []) => {
        if (!val) return;
        const matches = findInputs(labels, excludes);
        matches.forEach(input => {
          if (setInputValue(input, val)) filledCount++;
        });
      };

      fillGroup(["email address", "email", "e-mail", "enter your email address"], p.email, ["city", "country", "location", "address in city"]);
      fillGroup(["mobile number", "mobile", "phone number", "phone", "contact number", "enter your mobile number"], p.phone || "+91 9963214141", ["email"]);
      fillGroup(["age", "enter your age"], p.age || "29", ["page", "percentage", "manage"]);
      fillGroup(["city", "current city", "enter your current city"], p.city || "Hyderabad", ["email", "company", "address"]);
      fillGroup(["company name", "last/current company", "current company", "last company", "employer", "organization"], p.current_company || "Analytics Consultancy", ["full name", "your name"]);
      fillGroup(["full name", "your name", "candidate name", "applicant name", "enter your name"], p.full_name, ["company", "employer", "organization", "college", "university"]);
      fillGroup(["first name", "given name", "fname"], p.first_name, ["company"]);
      fillGroup(["last name", "family name", "surname", "lname"], p.last_name, ["company"]);
      fillGroup(["location", "current location", "country", "state"], p.location || "Hyderabad, India", ["email", "address"]);
      fillGroup(["notice period", "availability", "how soon"], p.notice_period || "Immediate / 15 Days", ["work mode", "company"]);
      fillGroup(["current ctc", "current annual salary", "current salary"], p.expected_salary || "Negotiable as per market standards");
      fillGroup(["expected ctc", "expected annual salary", "expected salary"], p.expected_salary || "Negotiable as per market standards");
      fillGroup(["linkedin"], p.linkedin);
      fillGroup(["github", "portfolio", "website", "link"], p.github);

      fillRadioGroup(["work setting", "how would you like to work", "work mode", "remote, on-site, hybrid"], p.work_mode || "Work from Home (Full-Time)");
      fillRadioGroup(["how soon you can start", "start working", "timeframe to start"], p.notice_period_option || "Immediately");
      fillRadioGroup(["total experience", "work experience in years", "choose your total work experience"], p.experience_range_option || "2 to 4 years");

      // Stage 2: AI Form Schema Classifier (LLM Reasoning for any remaining ambiguous / custom fields)
      const schemaFields = extractPageFormSchema();
      const companyName = document.title.replace(/[-|].*/, "").trim() || "the company";

      chrome.runtime.sendMessage({
        type: "AUTOFILL_SCHEMA",
        payload: { fields: schemaFields, profile: p, company: companyName }
      }, (schemaRes) => {
        if (schemaRes && schemaRes.ok && schemaRes.fill_map) {
          const map = schemaRes.fill_map;
          for (const [fieldId, target] of Object.entries(map)) {
            const el = document.querySelector(`[data-jarvis-id="${fieldId}"]`);
            if (!el || !target) continue;
            
            if (target.action === "fill" && target.value) {
              if (setInputValue(el, target.value)) filledCount++;
            } else if (target.action === "select_option" && target.option) {
              const options = Array.from(el.querySelectorAll('div[role="radio"], input[type="radio"], label, div.docssharedWizToggleLabeledContainer'));
              for (const opt of options) {
                const optText = (opt.innerText || opt.getAttribute("aria-label") || opt.value || "").toLowerCase();
                if (optText.includes(target.option.toLowerCase()) || target.option.toLowerCase().includes(optText)) {
                  opt.focus();
                  opt.click();
                  opt.dispatchEvent(new Event("change", { bubbles: true }));
                  filledCount++;
                  break;
                }
              }
            }
          }
        }
        
        btn.innerText = `✓ AI FILLED (${filledCount})`;
        setTimeout(() => { btn.innerText = "⚡ AUTOFILL"; }, 3000);
      });
    });
  });

  // 1-Click Save Job Handler
  document.getElementById("jarvis-save-trigger").addEventListener("click", () => {
    const btn = document.getElementById("jarvis-save-trigger");
    btn.innerText = "⏳ Saving…";

    const payload = {
      url: window.location.href,
      title: document.title.replace(/[-|].*/, "").trim() || "Data Analyst",
      company: window.location.hostname.replace("www.", "").split(".")[0] || "Company",
      description: document.body.innerText.slice(0, 2000),
    };

    chrome.runtime.sendMessage({ type: "SAVE_JOB", payload }, (res) => {
      if (res && res.ok) {
        btn.innerText = "✓ SAVED!";
      } else {
        btn.innerText = "❌ Failed";
      }
      setTimeout(() => { btn.innerText = "📌 SAVE"; }, 2500);
    });
  });
})();
