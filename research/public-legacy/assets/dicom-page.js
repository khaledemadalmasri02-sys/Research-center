const token = () => localStorage.getItem("token") || "";
const authHeaders = () => ({
  "Content-Type": "application/json",
  ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
});

document.getElementById("saveMeta").addEventListener("click", async () => {
  const body = {
    patientId: Number(document.getElementById("patientId").value),
    objectKey: document.getElementById("objectKey").value,
    modality: document.getElementById("modality").value,
    studyInstanceUid: document.getElementById("studyUid").value,
    seriesInstanceUid: document.getElementById("seriesUid").value,
    sopInstanceUid: document.getElementById("sopUid").value,
    acquisitionDate: document.getElementById("acqDate").value,
    metadata: JSON.parse(document.getElementById("metadata").value || "{}"),
  };
  const res = await fetch("/api/dicom/metadata", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  alert(res.ok ? "Saved ✓" : `Error ${res.status}: ${(await res.json()).error}`);
});

document.getElementById("loadStudies").addEventListener("click", async () => {
  const pid = document.getElementById("studyPatientId").value;
  const res = await fetch(`/api/dicom/studies/${pid}`, { headers: authHeaders() });
  const data = await res.json();
  const out = document.getElementById("studiesOut");
  out.innerHTML = (data.studies || [])
    .map(
      (s) =>
        `<div><span class="badge">${s.imageCount} imgs</span> ${s.modality || "?"} — ${s.studyInstanceUid}${s.acquisitionDate ? " (" + s.acquisitionDate + ")" : ""}</div>`
    )
    .join("") || "<div>No studies</div>";
});

document.getElementById("deidBtn").addEventListener("click", async () => {
  const id = Number(document.getElementById("deidId").value);
  const res = await fetch("/api/dicom/deidentify", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  document.getElementById("deidOut").textContent = JSON.stringify(data.metadata, null, 2);
});
