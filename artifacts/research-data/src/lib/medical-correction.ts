/**
 * Local medical correction — runs entirely in the browser, no API call.
 *
 * Strategy (applied in order):
 *  1. Abbreviation expansion   — "bp" → "blood pressure"
 *  2. Phonetic / misheard fix  — "new monia" → "pneumonia"
 *  3. Drug-name normalisation  — "metformin" casing, etc.
 *
 * All matching is case-insensitive; the replacement preserves the original
 * sentence casing convention (lower-case by default unless the entry says so).
 */

export interface Correction {
  original:  string;
  corrected: string;
  reason:    string;
}

export interface CorrectionResult {
  corrected:   string;
  corrections: Correction[];
}

// ─── 1. Abbreviation expansion ────────────────────────────────────────────────
// Word-boundary matched, whole-word only.

const ABBREVIATIONS: Record<string, string> = {
  // Vitals & measurements
  "bp":    "blood pressure",
  "hr":    "heart rate",
  "rr":    "respiratory rate",
  "spo2":  "oxygen saturation",
  "spo 2": "oxygen saturation",
  "o2":    "oxygen",
  "temp":  "temperature",
  "wt":    "weight",
  "ht":    "height",
  "bmi":   "BMI",
  "bsa":   "body surface area",

  // Common diagnoses / conditions
  "mi":    "myocardial infarction",
  "cva":   "cerebrovascular accident",
  "tia":   "transient ischemic attack",
  "chf":   "congestive heart failure",
  "hf":    "heart failure",
  "afib":  "atrial fibrillation",
  "a fib": "atrial fibrillation",
  "af":    "atrial fibrillation",
  "vt":    "ventricular tachycardia",
  "vf":    "ventricular fibrillation",
  "svt":   "supraventricular tachycardia",
  "dvt":   "deep vein thrombosis",
  "pe":    "pulmonary embolism / physical examination",
  "uti":   "urinary tract infection",
  "urti":  "upper respiratory tract infection",
  "lrti":  "lower respiratory tract infection",
  "copd":  "COPD",
  "osa":   "obstructive sleep apnea",
  "gerd":  "gastroesophageal reflux disease",
  "ibd":   "inflammatory bowel disease",
  "ckd":   "chronic kidney disease",
  "esrd":  "end-stage renal disease",
  "dm":    "diabetes mellitus",
  "dm1":   "type 1 diabetes mellitus",
  "dm2":   "type 2 diabetes mellitus",
  "htn":   "hypertension",
  "hld":   "hyperlipidemia",
  "cad":   "coronary artery disease",
  "pad":   "peripheral artery disease",
  "ra":    "rheumatoid arthritis",
  "sle":   "systemic lupus erythematosus",
  "ms":    "multiple sclerosis",

  // Symptoms
  "sob":   "shortness of breath",
  "cp":    "chest pain",
  "ha":    "headache",
  "n/v":   "nausea and vomiting",
  "n&v":   "nausea and vomiting",
  "nv":    "nausea and vomiting",
  "abd":   "abdominal",
  "loc":   "level of consciousness",
  "aloc":  "altered level of consciousness",

  // Labs
  "cbc":   "complete blood count",
  "bmp":   "basic metabolic panel",
  "cmp":   "comprehensive metabolic panel",
  "lfts":  "liver function tests",
  "lft":   "liver function test",
  "rfts":  "renal function tests",
  "rft":   "renal function test",
  "tsh":   "thyroid-stimulating hormone",
  "hba1c": "HbA1c",
  "hgb":   "hemoglobin",
  "wbc":   "white blood cell count",
  "rbc":   "red blood cell count",
  "plt":   "platelet count",
  "inr":   "international normalized ratio",
  "pt":    "prothrombin time",
  "ptt":   "partial thromboplastin time",
  "bnp":   "B-type natriuretic peptide",
  "crp":   "C-reactive protein",
  "esr":   "erythrocyte sedimentation rate",
  "psa":   "prostate-specific antigen",
  "ldl":   "LDL cholesterol",
  "hdl":   "HDL cholesterol",
  "tg":    "triglycerides",
  "egfr":  "eGFR",
  "cr":    "creatinine",
  "bun":   "blood urea nitrogen",
  "na":    "sodium",
  "k":     "potassium",
  "cl":    "chloride",
  "co2":   "bicarbonate",
  "gluc":  "glucose",

  // Imaging / procedures
  "cxr":   "chest X-ray",
  "ct":    "CT scan",
  "mri":   "MRI",
  "us":    "ultrasound",
  "echo":  "echocardiogram",
  "ekg":   "electrocardiogram",
  "ecg":   "electrocardiogram",
  "eeg":   "electroencephalogram",
  "emg":   "electromyogram",
  "cath":  "catheterization",
  "cabg":  "coronary artery bypass graft",
  "pcr":   "polymerase chain reaction",

  // Medications
  "abx":   "antibiotics",
  "ppis":  "proton pump inhibitors",
  "ppi":   "proton pump inhibitor",
  "nsaid": "NSAID",
  "nsaids":"NSAIDs",
  "ace":   "ACE inhibitor",
  "arb":   "ARB",
  "ssri":  "SSRI",
  "snri":  "SNRI",
  "tca":   "tricyclic antidepressant",
  "prn":   "as needed",
  "qd":    "once daily",
  "bid":   "twice daily",
  "tid":   "three times daily",
  "qid":   "four times daily",
  "po":    "by mouth",
  "iv":    "intravenously",
  "im":    "intramuscularly",
  "sq":    "subcutaneously",
  "sl":    "sublingually",
  "npo":   "nothing by mouth",

  // Clinical context
  "hx":    "history",
  "pmh":   "past medical history",
  "psh":   "past surgical history",
  "fh":    "family history",
  "sh":    "social history",
  "ros":   "review of systems",
  "phys-exam": "physical examination",
  "cc":    "chief complaint",
  "hpi":   "history of present illness",
  "a&p":   "assessment and plan",
  "a/p":   "assessment and plan",
  "ddx":   "differential diagnosis",
  "dx":    "diagnosis",
  "tx":    "treatment",
  "rx":    "prescription",
  "f/u":   "follow-up",
  "fu":    "follow-up",
  "d/c":   "discharge",
  "dc":    "discharge",
  "w/u":   "workup",
  "wu":    "workup",
  "wnl":   "within normal limits",
  "nad":   "no acute distress",
  "aox3":  "alert and oriented times three",
  "aao":   "alert and oriented",
  "lol":   "level of life",  // avoid slang interpretation
  "yo":    "year old",
  "y/o":   "year old",
  "m":     "male",
  "f":     "female",
};

// ─── 2. Phonetic / mishearing corrections ─────────────────────────────────────
// These are multi-word patterns the browser often mishears.

const PHONETIC: Array<{ find: RegExp; replace: string; reason: string }> = [
  { find: /\bnew\s+monia\b/gi,            replace: "pneumonia",              reason: "phonetic: 'new monia' → pneumonia" },
  { find: /\bnew\s+mo\b/gi,               replace: "pneumo",                 reason: "phonetic: 'new mo' → pneumo" },
  { find: /\bside\s+effect\s+s\b/gi,      replace: "side effects",           reason: "phonetic: plural" },
  { find: /\bmy\s+oh\s+card\b/gi,         replace: "myocardial",             reason: "phonetic: myocardial" },
  { find: /\btaky\s*cardia\b/gi,          replace: "tachycardia",            reason: "phonetic: tachycardia" },
  { find: /\brady\s*cardia\b/gi,          replace: "bradycardia",            reason: "phonetic: bradycardia" },
  { find: /\barrhythmia\b/gi,             replace: "arrhythmia",             reason: "common misspelling" },
  { find: /\bfib\s*rilat\w+\b/gi,         replace: "fibrillation",           reason: "phonetic: fibrillation" },
  { find: /\bhy\s*per\s*ten\w+\b/gi,      replace: "hypertension",           reason: "phonetic: hypertension" },
  { find: /\bhy\s*po\s*gly\w+\b/gi,       replace: "hypoglycemia",           reason: "phonetic: hypoglycemia" },
  { find: /\bhy\s*per\s*gly\w+\b/gi,      replace: "hyperglycemia",          reason: "phonetic: hyperglycemia" },
  { find: /\bdiabetes\s+melit\w*\b/gi,    replace: "diabetes mellitus",      reason: "phonetic: mellitus" },
  { find: /\bing\s*uinal\b/gi,            replace: "inguinal",               reason: "phonetic: inguinal" },
  { find: /\bper\s*i\s*card\w+\b/gi,      replace: "pericarditis",           reason: "phonetic: pericarditis" },
  { find: /\bendo\s*card\w+\b/gi,         replace: "endocarditis",           reason: "phonetic: endocarditis" },
  { find: /\bmyo\s*card\w+\b/gi,          replace: "myocarditis",            reason: "phonetic: myocarditis" },
  { find: /\bdys\s*pnea\b/gi,             replace: "dyspnea",                reason: "phonetic: dyspnea" },
  { find: /\bortho\s*pnea\b/gi,           replace: "orthopnea",              reason: "phonetic: orthopnea" },
  { find: /\bdiaphor\w+\b/gi,             replace: "diaphoresis",            reason: "phonetic: diaphoresis" },
  { find: /\bsyn\s*cope\b/gi,             replace: "syncope",                reason: "phonetic: syncope" },
  { find: /\bpal\s*pit\w+\b/gi,           replace: "palpitations",           reason: "phonetic: palpitations" },
  { find: /\bede\s*ma\b/gi,               replace: "edema",                  reason: "phonetic: edema" },
  { find: /\bpet\s*ech\w+\b/gi,           replace: "petechiae",              reason: "phonetic: petechiae" },
  { find: /\bjaun\s*dice\b/gi,            replace: "jaundice",               reason: "phonetic: jaundice" },
  { find: /\bhep\s*ato\s*meg\w+\b/gi,     replace: "hepatomegaly",           reason: "phonetic: hepatomegaly" },
  { find: /\bspleno\s*meg\w+\b/gi,        replace: "splenomegaly",           reason: "phonetic: splenomegaly" },
  { find: /\blymph\s*aden\w+\b/gi,        replace: "lymphadenopathy",        reason: "phonetic: lymphadenopathy" },
  { find: /\batro\s*phy\b/gi,             replace: "atrophy",                reason: "phonetic: atrophy" },
  { find: /\bhy\s*per\s*tro\s*phy\b/gi,   replace: "hypertrophy",            reason: "phonetic: hypertrophy" },
  { find: /\bsten\s*osis\b/gi,            replace: "stenosis",               reason: "phonetic: stenosis" },
  { find: /\breg\s*urgi\w+\b/gi,          replace: "regurgitation",          reason: "phonetic: regurgitation" },
  { find: /\binsuf\w*\b/gi,               replace: "insufficiency",          reason: "phonetic: insufficiency" },
  { find: /\bpneu\s*mo\s*thorax\b/gi,     replace: "pneumothorax",           reason: "phonetic: pneumothorax" },
  { find: /\bhy\s*dro\s*thorax\b/gi,      replace: "hydrothorax",            reason: "phonetic: hydrothorax" },
  { find: /\bhemo\s*thorax\b/gi,          replace: "hemothorax",             reason: "phonetic: hemothorax" },
  { find: /\bsepti\s*cemia\b/gi,          replace: "septicemia",             reason: "phonetic: septicemia" },
  { find: /\bbacter\s*emia\b/gi,          replace: "bacteremia",             reason: "phonetic: bacteremia" },
  { find: /\bane\s*mia\b/gi,              replace: "anemia",                 reason: "phonetic: anemia" },
  { find: /\bleuk\s*emia\b/gi,            replace: "leukemia",               reason: "phonetic: leukemia" },
  { find: /\bthrombo\s*cyto\s*penia\b/gi, replace: "thrombocytopenia",       reason: "phonetic: thrombocytopenia" },
  { find: /\bpoly\s*cyth\w+\b/gi,         replace: "polycythemia",           reason: "phonetic: polycythemia" },
  { find: /\bcoagul\w+\b/gi,              replace: "coagulopathy",           reason: "phonetic: coagulopathy" },
  { find: /\barthr\s*itis\b/gi,           replace: "arthritis",              reason: "phonetic: arthritis" },
  { find: /\bosteo\s*por\w+\b/gi,         replace: "osteoporosis",           reason: "phonetic: osteoporosis" },
  { find: /\bosteo\s*arth\w+\b/gi,        replace: "osteoarthritis",         reason: "phonetic: osteoarthritis" },
  { find: /\bfrac\s*ture\b/gi,            replace: "fracture",               reason: "phonetic: fracture" },
  { find: /\bsub\s*dural\b/gi,            replace: "subdural",               reason: "phonetic: subdural" },
  { find: /\bepidur\w+\b/gi,              replace: "epidural",               reason: "phonetic: epidural" },
  { find: /\bisch\s*emia\b/gi,            replace: "ischemia",               reason: "phonetic: ischemia" },
  { find: /\bin\s*farct\w*\b/gi,          replace: "infarction",             reason: "phonetic: infarction" },
  { find: /\bhem\s*orrhage\b/gi,          replace: "hemorrhage",             reason: "phonetic: hemorrhage" },
  { find: /\ban\s*eurysm\b/gi,            replace: "aneurysm",               reason: "phonetic: aneurysm" },
  { find: /\bthromb\s*osis\b/gi,          replace: "thrombosis",             reason: "phonetic: thrombosis" },
  { find: /\bem\s*bolism\b/gi,            replace: "embolism",               reason: "phonetic: embolism" },
  { find: /\bcel\s*lul\s*itis\b/gi,       replace: "cellulitis",             reason: "phonetic: cellulitis" },
  { find: /\babscess\b/gi,                replace: "abscess",                reason: "phonetic: abscess" },
  { find: /\bappend\s*ic\s*itis\b/gi,     replace: "appendicitis",           reason: "phonetic: appendicitis" },
  { find: /\bchol\s*ecyst\w+\b/gi,        replace: "cholecystitis",          reason: "phonetic: cholecystitis" },
  { find: /\bpancreat\s*itis\b/gi,        replace: "pancreatitis",           reason: "phonetic: pancreatitis" },
  { find: /\bdivert\s*icul\w+\b/gi,       replace: "diverticulitis",         reason: "phonetic: diverticulitis" },
  { find: /\bcolitis\b/gi,                replace: "colitis",                reason: "phonetic: colitis" },
  { find: /\bgastrit\s*is\b/gi,           replace: "gastritis",              reason: "phonetic: gastritis" },
  { find: /\bnephrit\s*is\b/gi,           replace: "nephritis",              reason: "phonetic: nephritis" },
  { find: /\bpyelon\s*ephr\w+\b/gi,       replace: "pyelonephritis",         reason: "phonetic: pyelonephritis" },
  { find: /\bglo\s*mer\s*ulo\w+\b/gi,     replace: "glomerulonephritis",     reason: "phonetic: glomerulonephritis" },
  { find: /\bprosta\s*titis\b/gi,         replace: "prostatitis",            reason: "phonetic: prostatitis" },
  { find: /\bten\s*don\s*itis\b/gi,       replace: "tendonitis",             reason: "phonetic: tendonitis" },
  { find: /\bburs\s*itis\b/gi,            replace: "bursitis",               reason: "phonetic: bursitis" },
  { find: /\bmenin\s*gitis\b/gi,          replace: "meningitis",             reason: "phonetic: meningitis" },
  { find: /\bencephal\w+\b/gi,            replace: "encephalitis",           reason: "phonetic: encephalitis" },
  { find: /\bneurop\s*athy\b/gi,          replace: "neuropathy",             reason: "phonetic: neuropathy" },
  { find: /\bpar\s*esth\w+\b/gi,          replace: "paresthesia",            reason: "phonetic: paresthesia" },
  { find: /\bpar\s*aly\s*sis\b/gi,        replace: "paralysis",              reason: "phonetic: paralysis" },
  { find: /\bdys\s*phag\w+\b/gi,          replace: "dysphagia",              reason: "phonetic: dysphagia" },
  { find: /\bdys\s*arth\w+\b/gi,          replace: "dysarthria",             reason: "phonetic: dysarthria" },
  { find: /\bapha\s*sia\b/gi,             replace: "aphasia",                reason: "phonetic: aphasia" },
  { find: /\bapnea\b/gi,                  replace: "apnea",                  reason: "phonetic: apnea" },
  { find: /\bhy\s*pox\s*ia\b/gi,          replace: "hypoxia",                reason: "phonetic: hypoxia" },
  { find: /\bhy\s*per\s*capnia\b/gi,      replace: "hypercapnia",            reason: "phonetic: hypercapnia" },
  { find: /\bacy\s*dosis\b/gi,            replace: "acidosis",               reason: "phonetic: acidosis" },
  { find: /\balk\s*alosis\b/gi,           replace: "alkalosis",              reason: "phonetic: alkalosis" },
];

// ─── 3. Drug name casing / spelling corrections ───────────────────────────────
// Only casing — do not rephrase drug names.

const DRUG_FIXES: Array<{ find: RegExp; replace: string }> = [
  { find: /\bmetformin\b/gi,       replace: "metformin" },
  { find: /\blisinopril\b/gi,      replace: "lisinopril" },
  { find: /\bamlodipine\b/gi,      replace: "amlodipine" },
  { find: /\batorvastatin\b/gi,    replace: "atorvastatin" },
  { find: /\brosuvastatin\b/gi,    replace: "rosuvastatin" },
  { find: /\bsimvastatin\b/gi,     replace: "simvastatin" },
  { find: /\bomeprazole\b/gi,      replace: "omeprazole" },
  { find: /\bpantoprazole\b/gi,    replace: "pantoprazole" },
  { find: /\besomeprazole\b/gi,    replace: "esomeprazole" },
  { find: /\baspirin\b/gi,         replace: "aspirin" },
  { find: /\bibuprofen\b/gi,       replace: "ibuprofen" },
  { find: /\bnaproxen\b/gi,        replace: "naproxen" },
  { find: /\bwarfarin\b/gi,        replace: "warfarin" },
  { find: /\brivaroxaban\b/gi,     replace: "rivaroxaban" },
  { find: /\bapixaban\b/gi,        replace: "apixaban" },
  { find: /\bdabigatran\b/gi,      replace: "dabigatran" },
  { find: /\bclopidogrel\b/gi,     replace: "clopidogrel" },
  { find: /\bplavix\b/gi,          replace: "Plavix" },
  { find: /\blopressor\b/gi,       replace: "Lopressor" },
  { find: /\bmetoprolol\b/gi,      replace: "metoprolol" },
  { find: /\bcarvedilol\b/gi,      replace: "carvedilol" },
  { find: /\bbisoprolol\b/gi,      replace: "bisoprolol" },
  { find: /\batenolol\b/gi,        replace: "atenolol" },
  { find: /\bpropranolol\b/gi,     replace: "propranolol" },
  { find: /\bfurosemide\b/gi,      replace: "furosemide" },
  { find: /\bspironolactone\b/gi,  replace: "spironolactone" },
  { find: /\bhydrochlorothiazide\b/gi, replace: "hydrochlorothiazide" },
  { find: /\bamoxicillin\b/gi,     replace: "amoxicillin" },
  { find: /\bazithromycin\b/gi,    replace: "azithromycin" },
  { find: /\bciprofloxacin\b/gi,   replace: "ciprofloxacin" },
  { find: /\bdoxycycline\b/gi,     replace: "doxycycline" },
  { find: /\btrimethoprim\b/gi,    replace: "trimethoprim" },
  { find: /\bvancomycin\b/gi,      replace: "vancomycin" },
  { find: /\bpiperacillin\b/gi,    replace: "piperacillin" },
  { find: /\btazobactam\b/gi,      replace: "tazobactam" },
  { find: /\bmeropenem\b/gi,       replace: "meropenem" },
  { find: /\bfluconazole\b/gi,     replace: "fluconazole" },
  { find: /\bacyclovir\b/gi,       replace: "acyclovir" },
  { find: /\bvalacyclovir\b/gi,    replace: "valacyclovir" },
  { find: /\binsulin\b/gi,         replace: "insulin" },
  { find: /\bglipizide\b/gi,       replace: "glipizide" },
  { find: /\bglyburide\b/gi,       replace: "glyburide" },
  { find: /\bsitagliptin\b/gi,     replace: "sitagliptin" },
  { find: /\bsemaglutide\b/gi,     replace: "semaglutide" },
  { find: /\bozempic\b/gi,         replace: "Ozempic" },
  { find: /\blevothyroxine\b/gi,   replace: "levothyroxine" },
  { find: /\bsynthroid\b/gi,       replace: "Synthroid" },
  { find: /\bprednisone\b/gi,      replace: "prednisone" },
  { find: /\bmethylprednisolone\b/gi, replace: "methylprednisolone" },
  { find: /\bdexamethasone\b/gi,   replace: "dexamethasone" },
  { find: /\bhydrocortisone\b/gi,  replace: "hydrocortisone" },
  { find: /\balbuterol\b/gi,       replace: "albuterol" },
  { find: /\bsalbutamol\b/gi,      replace: "salbutamol" },
  { find: /\bsalmeterol\b/gi,      replace: "salmeterol" },
  { find: /\btiotropium\b/gi,      replace: "tiotropium" },
  { find: /\bfluticasone\b/gi,     replace: "fluticasone" },
  { find: /\bbudesonide\b/gi,      replace: "budesonide" },
  { find: /\bsertraline\b/gi,      replace: "sertraline" },
  { find: /\bfluoxetine\b/gi,      replace: "fluoxetine" },
  { find: /\bescitalopram\b/gi,    replace: "escitalopram" },
  { find: /\bcitalopram\b/gi,      replace: "citalopram" },
  { find: /\bvenlafaxine\b/gi,     replace: "venlafaxine" },
  { find: /\bduloxetine\b/gi,      replace: "duloxetine" },
  { find: /\bbupropion\b/gi,       replace: "bupropion" },
  { find: /\bmirtazapine\b/gi,     replace: "mirtazapine" },
  { find: /\bquetiapine\b/gi,      replace: "quetiapine" },
  { find: /\bolanzapine\b/gi,      replace: "olanzapine" },
  { find: /\brisperidone\b/gi,     replace: "risperidone" },
  { find: /\baripiprazole\b/gi,    replace: "aripiprazole" },
  { find: /\bhaloperidol\b/gi,     replace: "haloperidol" },
  { find: /\blorazepam\b/gi,       replace: "lorazepam" },
  { find: /\bdiazepam\b/gi,        replace: "diazepam" },
  { find: /\bclonazepam\b/gi,      replace: "clonazepam" },
  { find: /\balprazolam\b/gi,      replace: "alprazolam" },
  { find: /\bzolpidem\b/gi,        replace: "zolpidem" },
  { find: /\bgabapentin\b/gi,      replace: "gabapentin" },
  { find: /\bpregabalin\b/gi,      replace: "pregabalin" },
  { find: /\bphenytoin\b/gi,       replace: "phenytoin" },
  { find: /\bvalproate\b/gi,       replace: "valproate" },
  { find: /\blamotrigine\b/gi,     replace: "lamotrigine" },
  { find: /\blevetiracetam\b/gi,   replace: "levetiracetam" },
  { find: /\bmorphine\b/gi,        replace: "morphine" },
  { find: /\boxyCODONE\b/gi,       replace: "oxycodone" },
  { find: /\boxycodone\b/gi,       replace: "oxycodone" },
  { find: /\bhydrocodone\b/gi,     replace: "hydrocodone" },
  { find: /\btramadol\b/gi,        replace: "tramadol" },
  { find: /\bfentanyl\b/gi,        replace: "fentanyl" },
  { find: /\bnaloxone\b/gi,        replace: "naloxone" },
  { find: /\bnarcan\b/gi,          replace: "Narcan" },
  { find: /\bcodeine\b/gi,         replace: "codeine" },
  { find: /\bparacetamol\b/gi,     replace: "paracetamol" },
  { find: /\bacetaminophen\b/gi,   replace: "acetaminophen" },
  { find: /\btylenol\b/gi,         replace: "Tylenol" },
  { find: /\badvil\b/gi,           replace: "Advil" },
  { find: /\balteplase\b/gi,       replace: "alteplase" },
  { find: /\btenecteplase\b/gi,    replace: "tenecteplase" },
  { find: /\bheparin\b/gi,         replace: "heparin" },
  { find: /\benoxaparin\b/gi,      replace: "enoxaparin" },
  { find: /\blovenox\b/gi,         replace: "Lovenox" },
  { find: /\bnitroglycerin\b/gi,   replace: "nitroglycerin" },
  { find: /\bdigoxin\b/gi,         replace: "digoxin" },
  { find: /\bamiodarone\b/gi,      replace: "amiodarone" },
  { find: /\badenosine\b/gi,       replace: "adenosine" },
  { find: /\batropine\b/gi,        replace: "atropine" },
  { find: /\bepinephrine\b/gi,     replace: "epinephrine" },
  { find: /\badrenaline\b/gi,      replace: "adrenaline" },
  { find: /\bnorepinephrine\b/gi,  replace: "norepinephrine" },
  { find: /\bdopamine\b/gi,        replace: "dopamine" },
  { find: /\bdobutamine\b/gi,      replace: "dobutamine" },
  { find: /\bvasopressin\b/gi,     replace: "vasopressin" },
];

// ─── Main corrector ──────────────────────────────────────────────────────────

export function correctMedicalText(input: string): CorrectionResult {
  const corrections: Correction[] = [];
  let text = input;

  // ── Step 1: phonetic multi-word patterns ──────────────────────────────────
  for (const { find, replace, reason } of PHONETIC) {
    const match = text.match(find);
    if (match) {
      corrections.push({ original: match[0], corrected: replace, reason });
      text = text.replace(find, replace);
    }
  }

  // ── Step 2: abbreviation expansion (whole-word) ────────────────────────────
  for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
    // Escape dots/slashes in abbreviation
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\w/])${escaped}(?![\\w/])`, "gi");
    const match = text.match(re);
    if (match) {
      corrections.push({ original: match[0], corrected: expansion, reason: `abbreviation: ${abbr} → ${expansion}` });
      text = text.replace(re, expansion);
    }
  }

  // ── Step 3: drug name normalisation ───────────────────────────────────────
  for (const { find, replace } of DRUG_FIXES) {
    if (find.test(text)) {
      find.lastIndex = 0;
      const match = text.match(find);
      if (match && match[0] !== replace) {
        corrections.push({ original: match[0], corrected: replace, reason: "drug name spelling" });
      }
      text = text.replace(find, replace);
    }
    find.lastIndex = 0;
  }

  return { corrected: text, corrections };
}
