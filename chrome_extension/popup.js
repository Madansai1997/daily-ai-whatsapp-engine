// Popup JS Handler

document.addEventListener("DOMContentLoaded", () => {
  const urlInput = document.getElementById("server-url");
  const saveBtn = document.getElementById("btn-save-options");

  chrome.storage.local.get(["serverUrl"], (data) => {
    if (data.serverUrl) {
      urlInput.value = data.serverUrl;
    }
  });

  saveBtn.addEventListener("click", () => {
    const val = urlInput.value.trim().replace(/\/$/, "");
    chrome.storage.local.set({ serverUrl: val }, () => {
      saveBtn.innerText = "✓ Saved!";
      setTimeout(() => { saveBtn.innerText = "Save Settings"; }, 2000);
    });
  });
});
