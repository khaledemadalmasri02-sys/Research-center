const api = async (method, path, body) => {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch("/api/consent" + path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
};

const el = (id) => document.getElementById(id);

async function checkAuth() {
  try {
    const data = await api("GET", "/status?patientId=0");
    el("authStatus").textContent = "Authenticated session active.";
  } catch {
    el("authStatus").textContent = "Not authenticated — log in via the main app first.";
  }
}

async function loadVersions() {
  try {
    const { versions } = await api("GET", "/versions");
    const sel = el("versionSelect");
    sel.innerHTML = versions.map((v) => `<option value="${v.id}">${v.label}${v.irbNumber ? " (" + v.irbNumber + ")" : ""}</option>`).join("");
    el("versions").innerHTML = versions.length
      ? `<table><tr><th>Code</th><th>Label</th><th>IRB</th></tr>${versions.map((v) => `<tr><td>${v.code}</td><td>${v.label}</td><td>${v.irbNumber || "—"}</td></tr>`).join("")}</table>`
      : `<p class="muted">No active templates.</p>`;
  } catch (e) {
    el("versions").textContent = "Error: " + e.message;
  }
}

async function loadProtocols() {
  try {
    const { protocols } = await api("GET", "/protocols");
    el("protocols").innerHTML = protocols.length
      ? `<table><tr><th>Code</th><th>Title</th><th>IRB</th><th>PI</th></tr>${protocols.map((p) => `<tr><td>${p.code}</td><td>${p.title}</td><td>${p.irbNumber || "—"}</td><td>${p.pi_name || "—"}</td></tr>`).join("")}</table>`
      : `<p class="muted">No protocols yet.</p>`;
  } catch (e) {
    el("protocols").textContent = "Error: " + e.message;
  }
}

async function loadConsents() {
  const pid = el("patientId").value;
  if (!pid) { el("consentList").textContent = "Enter a patient ID."; return; }
  try {
    const { consents } = await api("GET", "/?patientId=" + pid);
    el("consentList").innerHTML = consents.length
      ? `<table><tr><th>ID</th><th>Template</th><th>Status</th><th>Signed</th><th>Withdrawn</th><th></th></tr>${consents.map((c) => `<tr><td>${c.id}</td><td>${c.versionLabel || c.consentVersionId}</td><td><span class="badge ${c.status}">${c.status}</span></td><td>${c.signedAt || "—"}</td><td>${c.withdrawnAt || "—"}</td><td>${c.status === "signed" ? `<button class="secondary" onclick="withdraw(${c.id})">Withdraw</button>` : ""}</td></tr>`).join("")}</table>`
      : `<p class="muted">No consents for this patient.</p>`;
  } catch (e) {
    el("consentList").textContent = "Error: " + e.message;
  }
}

window.withdraw = async (id) => {
  const reason = prompt("Withdrawal reason:");
  if (reason === null) return;
  try {
    await api("POST", "/" + id + "/withdraw", { reason });
    loadConsents();
  } catch (e) { alert("Failed: " + e.message); }
};

el("signBtn").addEventListener("click", async () => {
  const pid = el("patientId").value;
  const vid = el("versionSelect").value;
  if (!pid || !vid) return alert("Patient ID and template required.");
  try {
    await api("POST", "/", { patientId: Number(pid), consentVersionId: Number(vid), documentObjectKey: el("docKey").value || undefined });
    loadConsents();
  } catch (e) { alert("Failed: " + e.message); }
});

el("statusBtn").addEventListener("click", async () => {
  const pid = el("patientId").value;
  if (!pid) return;
  try {
    const r = await api("GET", "/status?patientId=" + pid);
    el("statusResult").textContent = r.hasValidConsent ? `Valid consent on file (id ${r.consentId}).` : "No valid (signed, non-withdrawn) consent.";
  } catch (e) { el("statusResult").textContent = "Error: " + e.message; }
});

el("addProtocol").addEventListener("click", async () => {
  try {
    await api("POST", "/protocols", {
      code: el("pCode").value, title: el("pTitle").value,
      irbNumber: el("pIrb").value, piName: el("pPi").value,
    });
    loadProtocols();
  } catch (e) { alert("Failed: " + e.message); }
});

el("addVersion").addEventListener("click", async () => {
  try {
    await api("POST", "/versions", {
      code: el("vCode").value, label: el("vLabel").value,
      irbNumber: el("vIrb").value, text: el("vText").value,
    });
    loadVersions();
  } catch (e) { alert("Failed: " + e.message); }
});

checkAuth();
loadVersions();
loadProtocols();
