# Poster Prompt for Gemini
## (Copy the block below into Gemini)

```
Create a professional technical poster (A2 / 16:24 portrait) that showcases the 'MedResearch Data Collection & Research Platform' — a live medical research website at research-center.fit. The poster should be suitable for a conference wall, engineering office, or LinkedIn post banner.

Visual style: clean, modern, medical-tech aesthetic. Dark background (#0d1117) with vibrant accent colors (teal #2f76d3, amber #f59e0b, green #10b981, soft white text). Sans-serif headings, legible body text. Subtle abstract medical-network pattern (DNA helix, neural connections, data nodes) in the background at very low opacity.

Layout — 5 horizontal sections stacked vertically with a thin vertical accent line on the left connecting them:

1. HEADER (top, 15% height)
   - Large title: 'MedResearch Data Collection & Research Platform'
   - Subtitle: 'Research-grade data management for medical studies'
   - Badge: 'HIPAA / GDPR compliant  •  Live at research-center.fit'
   - Small globe icon with 'Production' label

2. WEBSITE OVERVIEW (15% height)
   - Short description: 'A complete web platform for medical research teams to collect, manage, and analyze patient data — from structured forms and DICOM images to statistical reporting and AI prediction tracking. Built for studies that need to be both powerful and compliant.'
   - 3 small icon+label tags: 'Web App' • 'Mobile Friendly' • 'Secure by Default'

3. USER-FACING FEATURES (25% height)
   - A 2x3 grid of feature preview cards with icons:
     Card 1: 'Patient Records' — 'Dynamic, customizable data entry forms with unlimited fields. Capture chief complaints, vitals, diagnosis, and notes in a structured way.'
     Card 2: 'Medical Image Storage' — 'Upload and view radiology images (JPEG, PNG, DICOM). Images stored securely with object keys — never inline in the database. Presigned URLs for fast downloads.'
     Card 3: 'Excel Import/Export' — 'Bulk import patient data from Excel with column mapping. Export to CSV or Excel for offline analysis. Supports backfilling existing records.'
     Card 4: 'Statistical Analysis' — 'Run SPSS-compatible statistics (descriptives, frequencies, t-tests, ANOVA, regression) directly in the browser. Save analysis configurations and export results.'
     Card 5: 'Search & Saved Views' — 'Search across all patient records with filters, sorting, and saved views. Quick table search with 200ms debounce. Column visibility and density presets.'
     Card 6: 'Activity Audit Trail' — 'Personal activity timeline showing every action you take. Admins see a global timeline with full filtering. Every mutation is logged with timestamp and user.'

4. RESEARCH-WORKFLOW FEATURES (25% height)
   - A 2x3 grid of research-specific cards with icons:
     Card 1: 'Cohort Builder' — 'Define patient cohorts with custom filters. Export to CSV with a codebook. View cohort statistics and demographics.'
     Card 2: 'De-identification' — 'Pseudonymize patient data — map real patient IDs to study codes. Batch export de-identified datasets with configurable profiles. Built for data sharing ethics boards.'
     Card 3: 'Consent Management' — 'Versioned digital consent forms with IRB numbers. Track signed/withdrawn status. Store signed documents as PDFs with full audit trail.'
     Card 4: 'DICOM Viewer' — 'Upload DICOM imaging studies. Extract metadata (modality, body part, SOP/Series/Study UIDs). Track de-identification status per image.'
     Card 5: 'ML Model Tracking' — 'Register AI/ML models. Link predictions to patient records. Track evaluation metrics (AUC, sensitivity, specificity, F1). Ground-truth annotation workflow.'
     Card 6: 'Validation Rules' — 'Define per-field validation rules (required, range, regex). Severity levels (error/warning). Runtime checker catches data quality issues on entry.'

5. COMPLIANCE & SECURITY (15% height)
   - 4 metric highlights with icons:
     'End-to-End Encryption' (lock icon)
     'Access Auditing' (clipboard with checkmark)
     'Data Retention Policies' (calendar with trash)
     'SOC 2 Type II' (shield — replace with actual certification if different)
   - Short note: 'Built with medical research compliance in mind. PHI-aware field encryption, automatic session timeouts, per-IP rate limiting, and full data lineage from upload to analysis.'

6. FOOTER
   - 'Try it live at research-center.fit' with arrow icon
   - Hashtags: #HealthTech #MedicalResearch #DataManagement #CloudComputing #DICOM #MachineLearning #HIPAAcompliance

Instructions:
- Focus entirely on what a researcher or study coordinator would experience using the website. No code, no architecture diagrams, no developer workflows, no test counts, no CI/CD details.
- Every feature card should describe a user-facing capability with a brief benefit statement.
- Use iconography consistently — medical icons (stethoscope, heart-rate, microscope, file-medical), data icons (table, chart, search), security icons (lock, shield, audit).
- Ensure all text is legible from ~2 meters (headings ≥42pt, body ≥24pt).
- Include a QR code in the bottom-right for 'Scan to visit research-center.fit'.
- Image: 2480 x 3508 px (A2 @ 300 DPI), portrait. Export as single PNG.
```

## Notes
- If medical icons are unavailable, use simple circular badges with relevant emoji or 2-letter labels (PA = Patient Records, IM = Images, EX = Excel, ST = Stats, etc.)
- Keep the vertical accent line as a thin dotted stroke in amber so it doesn't compete with content
- Prioritize clarity and user-facing value over technical implementation details