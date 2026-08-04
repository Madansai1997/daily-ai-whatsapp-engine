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

  // Field selector mapping helper
  function findInputs(labels) {
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    return inputs.filter(input => {
      const name = (input.name || "").toLowerCase();
      const id = (input.id || "").toLowerCase();
      const placeholder = (input.placeholder || "").toLowerCase();
      const aria = (input.getAttribute("aria-label") || "").toLowerCase();
      
      // Look up parent label text
      let labelText = "";
      if (input.labels && input.labels.length) {
        labelText = Array.from(input.labels).map(l => l.innerText).join(" ").toLowerCase();
      } else if (input.parentElement) {
        labelText = input.parentElement.innerText.toLowerCase();
      }

      const combined = `${name} ${id} ${placeholder} ${aria} ${labelText}`;
      return labels.some(l => combined.includes(l.toLowerCase()));
    });
  }

  function setInputValue(input, val) {
    if (!input || val == null) return;
    input.focus();
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  }

  // 1-Click Autofill Handler
  document.getElementById("jarvis-autofill-trigger").addEventListener("click", () => {
    const btn = document.getElementById("jarvis-autofill-trigger");
    btn.innerText = "⏳ Filling…";

    chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (res) => {
      if (!res || !res.ok || !res.profile) {
        alert("⚠️ Failed to fetch candidate profile from JARVIS backend.");
        btn.innerText = "⚡ AUTOFILL";
        return;
      }

      const p = res.profile;

      // Fill First Name
      findInputs(["first name", "given name", "fname"]).forEach(i => setInputValue(i, p.first_name));
      // Fill Last Name
      findInputs(["last name", "family name", "surname", "lname"]).forEach(i => setInputValue(i, p.last_name));
      // Fill Full Name
      findInputs(["full name", "your name", "candidate name", "applicant name"]).forEach(i => setInputValue(i, p.full_name));
      // Fill Email
      findInputs(["email", "e-mail"]).forEach(i => setInputValue(i, p.email));
      // Fill Phone
      findInputs(["phone", "mobile", "contact number", "telephone"]).forEach(i => setInputValue(i, p.phone));
      // Fill LinkedIn
      findInputs(["linkedin"]).forEach(i => setInputValue(i, p.linkedin));
      // Fill GitHub / Portfolio
      findInputs(["github", "portfolio", "website"]).forEach(i => setInputValue(i, p.github));
      // Fill Location
      findInputs(["location", "city", "address"]).forEach(i => setInputValue(i, p.location));
      // Fill Notice Period
      findInputs(["notice", "availability", "start date"]).forEach(i => setInputValue(i, p.notice_period));
      // Fill Expected Salary
      findInputs(["salary", "ctc", "compensation"]).forEach(i => setInputValue(i, p.expected_salary));

      btn.innerText = "✓ FILLED!";
      setTimeout(() => { btn.innerText = "⚡ AUTOFILL"; }, 2500);
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
