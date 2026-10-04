# 🚀 Why I Built a Better Way to Run Medical Research Studies

## This post is for every researcher who has ever lost a CSV file, struggled to match up patient images with their forms, or wondered if their data is actually compliant.

## The Problem I Lived

Three years ago, I was helping run a radiology study. Here's how we "managed" our data:

- Patient forms in Excel sheets (multiple versions across three computers)
- DICOM images emailed as attachments or dropped in shared folders
- AI prediction outputs in yet another spreadsheet with no way to match back to patients
- Consent forms signed on paper and scanned to Google Drive
- A statistician who asked for "just the columns you need, cleaned up" and we spent two weeks in pivot tables

Every step was manual. Every handoff was a risk. And nobody could tell you with confidence: *"Are we HIPAA-compliant?"*

Sound familiar?

## What I Built Instead

**MedResearch** — a single platform where research teams can actually *work*, not fight their tools.

It's live at [research-center.fit](https://research-center.fit) if you want to try it.

### Here's what makes it different:

**📋 Dynamic Patient Records That Adapt to Your Study**

Forget rigid forms that don't match your study design. Create custom data entry forms with as many fields as you need — text, numbers, dates, dropdowns, image uploads. Need to track chief complaint in English *and* Arabic? Done. Need to add a new field mid-study? No migration scripts — just update the form.

**🖼️ Medical Images That Actually Stay Organized**

Upload DICOM, JPEG, or PNG images directly to patient records. Images are stored securely with the patient they belong to — no more hunting through folder structures to find "that scan from Tuesday." Download with one click, or get a shareable link that expires.

**📊 Built-In Statistics (No More Exporting to SPSS)**

This is the part that surprised me most. The platform includes a full statistical analysis engine — descriptives, frequencies, t-tests, ANOVA, regression. Run stats directly on your data, save your analysis setup, and export publication-ready tables. I built it because I kept getting requests like "can you just check if there's a correlation here?" that turned into hour-long spreadsheet marathons.

**🔍 Find Anything, Fast**

Built-in search across every field. Saved views for your favorite filters. Column visibility so you only see what matters. Density settings from compact to comfortable. Whether you're looking for "all patients over 65 with a chest X-ray" or "records updated last week," it's instant.

**🧬 Researcher Workflows, Not Just Data Entry**

This is where MedResearch pulls ahead of generic tools:

- **Cohort Builder** — Define patient groups with filters, export them with an auto-generated codebook, and run stats on just that subset
- **De-identification** — One-click pseudonymization to strip identifying information, with configurable profiles for different ethics boards
- **Consent Management** — Digital consent forms with version control, IRB tracking, and status monitoring (signed / withdrawn)
- **DICOM Metadata** — Extract and search by modality, body part, acquisition date, and more — no more manual spreadsheet matching
- **ML/AI Tracking** — If you're running AI predictions, link them to patient records, track model versions, and compare against ground truth annotations
- **Validation Rules** — Catch data quality issues at entry time (range checks, required fields, custom regex) instead of discovering them during analysis

## Why Not Just Use [Insert Existing Tool]?

I evaluated a lot of options. Here's what kept falling short:

| Tool | Gap |
|---|---|
| **REDCap** | Powerful but feels like it was designed in 2005. No built-in images. No statistics. Everything is a CSV export away from Excel hell. |
| **Castor EDC** | Great UI, but expensive for smaller studies. Limited offline capability. No local deployment option. |
| **REDCap + R** | You need a statistician who knows R. Half my collaborators don't. |
| **Google Forms + Drive** | Fine for surveys. Catastrophic for medical data. Compliance? Nope. |
| **Custom spreadsheets** | The thing we were all doing. It's literally a disaster waiting to happen. |

MedResearch was built because none of these actually solved the *full* workflow — from data collection to analysis to compliance — in one place.

## Key Differentiators

1. **One platform, end-to-end** — Collect data, store images, run stats, export results, manage consent, all without leaving the app
2. **Researcher-first design** — I didn't design this for a DBA. I designed it for someone who needs to run a study and get back to science
3. **Statistics that work** — SPSS-compatible methods built in. No exporting, no pivot tables, no lost hours
4. **Designed for medical data** — DICOM support, de-identification, consent tracking, and audit logs baked in from day one
5. **Open source** — No licensing fees. Deploy it yourself. Contribute back improvements.

## What's Working Now

- Live at [research-center.fit](https://research-center.fit)
- 300+ automated tests keeping it stable
- Used in production for active radiology studies
- MIT license — fully open source

## What's Next

- Mobile app for field data collection
- DICOM viewer (full image rendering, not just metadata)
- Collaborative annotations on images
- Integration with more AI/ML model types

## The Real Goal

I didn't build this to make a "cool tech project." I built it because I've watched brilliant researchers waste months on data wrangling that should take minutes.

If you're running a medical study and you're still managing data in spreadsheets and email attachments, I want to show you what's possible.

**Try it at [research-center.fit](https://research-center.fit) — it's free, open source, and built by someone who's been in your shoes.**

Or if you're working on something similar and want to collaborate, drop a comment or DM.

#HealthTech #MedicalResearch #DataManagement #ClinicalData #DICOM #MachineLearning #OpenSource #ResearchTools #DataScience #HealthcareIT