// JARVIS Career Copilot Content Script — Smart Form Filler & Page Inspector

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
    
    // Search up to 6 parent levels for container text (covers Google Forms, Workday, Lever, Greenhouse)
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
      
      // Must match at least one inclusion label
      const hasMatch = labels.some(l => context.includes(l.toLowerCase()));
      if (!hasMatch) return false;
      
      // Must NOT match any exclusion terms
      if (excludes.some(ex => context.includes(ex.toLowerCase()))) return false;
      
      return true;
    });
  }

  function setInputValue(input, val) {
    if (!input || val == null || val === "") return false;
    try {
      input.focus();
      
      // Native Property Setter Override (bypasses React, Google Forms, & framework state traps)
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, val);
      } else {
        input.value = val;
      }

      // Dispatch all input/change/keydown events
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

  // Radio button option selector helper (Google Forms, Workday, Lever)
  function fillRadioGroup(questionKeywords, targetOptionText) {
    if (!targetOptionText) return false;
    let clicked = false;
    
    const containers = Array.from(document.querySelectorAll('div[role="listitem"], fieldset, .freebirdFormviewerComponentsQuestionBaseRoot, .geFormComponents, div.form-group, div.mb-4, div.py-3'));
    
    for (const container of containers) {
      const text = (container.innerText || "").toLowerCase();
      if (questionKeywords.some(k => text.includes(k.toLowerCase()))) {
        // Find options inside this question container
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

  // 1-Click Autofill Handler
  document.getElementById("jarvis-autofill-trigger").addEventListener("click", () => {
    const btn = document.getElementById("jarvis-autofill-trigger");
    btn.innerText = "⏳ Filling…";

    chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (res) => {
      if (!res || !res.ok || !res.profile) {
        const errMsg = (res && res.error) ? res.error : "Network error / Backend unreachable";
        alert(`⚠️ Failed to fetch candidate profile from JARVIS backend: ${errMsg}`);
        btn.innerText = "⚡ AUTOFILL";
        return;
      }

      const p = res.profile;
      let filledCount = 0;

      const fillGroup = (labels, val, excludes = []) => {
        if (!val) return;
        const matches = findInputs(labels, excludes);
        matches.forEach(input => {
          if (setInputValue(input, val)) filledCount++;
        });
      };

      // 1. Email Address (Excludes 'city', 'location')
      fillGroup(["email address", "email", "e-mail", "enter your email address"], p.email, ["city", "country", "location", "address in city"]);
      
      // 2. Mobile Number (Excludes 'email')
      fillGroup(["mobile number", "mobile", "phone number", "phone", "contact number", "enter your mobile number"], p.phone || "+91 9963214141", ["email"]);

      // 3. Age
      fillGroup(["age", "enter your age"], p.age || "29", ["page", "percentage", "manage"]);

      // 4. City (Excludes 'email', 'company')
      fillGroup(["city", "current city", "enter your current city"], p.city || "Hyderabad", ["email", "company", "address"]);

      // 5. Current/Last Company Name (Excludes 'full name', 'your name')
      fillGroup(["company name", "last/current company", "current company", "last company", "employer", "organization"], p.current_company || "Analytics Consultancy", ["full name", "your name"]);

      // 6. Full Name (Excludes 'company', 'employer', 'organization')
      fillGroup(["full name", "your name", "candidate name", "applicant name", "enter your name"], p.full_name, ["company", "employer", "organization", "college", "university"]);

      // 7. First / Last Name
      fillGroup(["first name", "given name", "fname"], p.first_name, ["company"]);
      fillGroup(["last name", "family name", "surname", "lname"], p.last_name, ["company"]);

      // 8. Location (Excludes 'email', 'address')
      fillGroup(["location", "current location", "country", "state"], p.location || "Hyderabad, India", ["email", "address"]);

      // 9. Notice Period Text
      fillGroup(["notice period", "availability", "how soon"], p.notice_period || "Immediate / 15 Days", ["work mode", "company"]);

      // 10. Current CTC & Expected CTC
      fillGroup(["current ctc", "current annual salary", "current salary"], p.expected_salary || "Negotiable as per market standards");
      fillGroup(["expected ctc", "expected annual salary", "expected salary"], p.expected_salary || "Negotiable as per market standards");

      // 11. LinkedIn / Portfolio / GitHub
      fillGroup(["linkedin"], p.linkedin);
      fillGroup(["github", "portfolio", "website", "link"], p.github);

      // ── RADIO BUTTON / OPTION SELECTION ──
      // Preferred Work Setting (Remote / Home / Office / Hybrid)
      if (fillRadioGroup(["work setting", "how would you like to work", "work mode", "remote, on-site, hybrid"], p.work_mode || "Work from Home (Full-Time)")) {
        filledCount++;
      }

      // Start Timeframe / Notice Option (Immediately / 7 days / 15 days)
      if (fillRadioGroup(["how soon you can start", "start working", "timeframe to start"], p.notice_period_option || "Immediately")) {
        filledCount++;
      }

      // Total Experience Range (2 to 4 years / 4 to 6 years)
      if (fillRadioGroup(["total experience", "work experience in years", "choose your total work experience"], p.experience_range_option || "2 to 4 years")) {
        filledCount++;
      }

      // ── AI CUSTOM OPEN-ENDED QUESTION ANSWERING ──
      const textareas = Array.from(document.querySelectorAll("textarea, input[type='text']"));
      for (const ta of textareas) {
        if (ta.value && ta.value.trim() !== "") continue;
        const ctx = getFieldTextContext(ta);
        if (ctx.includes("why do you want to join") || ctx.includes("share your motivation") || ctx.includes("why should we hire")) {
          const companyName = document.title.replace(/[-|].*/, "").trim() || "the company";
          chrome.runtime.sendMessage({
            type: "ANSWER_QUESTION",
            payload: { question: ctx.slice(0, 300), company: companyName, role: p.target_role || "Data Analyst" }
          }, (ansRes) => {
            if (ansRes && ansRes.ok && ansRes.answer) {
              setInputValue(ta, ansRes.answer);
            }
          });
          break;
        }
      }

      if (filledCount > 0) {
        btn.innerText = `✓ FILLED (${filledCount})`;
      } else {
        alert("⚠️ Form labels mismatch or custom portal. Try clicking inside an input.");
        btn.innerText = "⚡ AUTOFILL";
      }
      setTimeout(() => { btn.innerText = "⚡ AUTOFILL"; }, 3000);
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
