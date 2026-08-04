// JARVIS Career Copilot Content Script — Form Filler & Page Inspector

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

  function findInputs(labels) {
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    return inputs.filter(input => {
      const type = (input.type || "").toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) return false;
      const context = getFieldTextContext(input);
      return labels.some(l => context.includes(l.toLowerCase()));
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

      const fillGroup = (labels, val) => {
        if (!val) return;
        const matches = findInputs(labels);
        matches.forEach(input => {
          if (setInputValue(input, val)) filledCount++;
        });
      };

      // Fill First Name
      fillGroup(["first name", "given name", "fname"], p.first_name);
      // Fill Last Name
      fillGroup(["last name", "family name", "surname", "lname"], p.last_name);
      // Fill Full Name
      fillGroup(["full name", "your name", "candidate name", "applicant name", "name"], p.full_name);
      // Fill Email
      fillGroup(["email", "e-mail", "mail"], p.email);
      // Fill Phone
      fillGroup(["phone", "mobile", "contact number", "telephone", "cell"], p.phone);
      // Fill LinkedIn
      fillGroup(["linkedin"], p.linkedin);
      // Fill GitHub / Portfolio
      fillGroup(["github", "portfolio", "website", "link"], p.github);
      // Fill Location
      fillGroup(["location", "city", "address", "country", "state"], p.location);
      // Fill Notice Period
      fillGroup(["notice", "availability", "start date", "how soon"], p.notice_period);
      // Fill Expected Salary
      fillGroup(["salary", "ctc", "compensation", "expected"], p.expected_salary);
      // Fill Work Authorization
      fillGroup(["authorized", "citizenship", "sponsorship", "work auth"], p.work_authorization);
      // Fill Experience
      fillGroup(["experience", "years of experience", "total experience"], p.experience_years);
      // Fill Skills
      fillGroup(["skills", "technical skills", "technologies"], p.skills);

      if (filledCount > 0) {
        btn.innerText = `✓ FILLED (${filledCount})`;
      } else {
        alert("⚠️ No matching fields found on this form. Try clicking inside an input or checking your profile fields.");
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

  // Auto-detect application confirmation page
  const bodyText = document.body.innerText.toLowerCase();
  if (
    bodyText.includes("thank you for applying") ||
    bodyText.includes("application submitted") ||
    bodyText.includes("your application has been received")
  ) {
    chrome.runtime.sendMessage({
      type: "MARK_APPLIED",
      payload: {
        url: window.location.href,
        company: window.location.hostname.replace("www.", "").split(".")[0],
        title: document.title
      }
    });
  }
})();
