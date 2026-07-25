import { Router } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import express from "express";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ── Groq client — Whisper Large V3 transcription ──────────────────────────────
function getGroq(): OpenAI {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  return new OpenAI({
    apiKey:  key,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

// ── OpenRouter client — text correction fallback ──────────────────────────────
function getOpenRouter(): OpenAI {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return new OpenAI({
    apiKey:  key,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://replit.com",
      "X-Title": "Medical Voice Dictation",
    },
  });
}

const OPENROUTER_MODEL = "mistralai/mistral-small-3.1-24b-instruct";

const MEDICAL_SYSTEM_PROMPT = `You are a medical transcription correction assistant.
The user will give you raw dictated text from a clinician. Your job is to:
1. Fix spelling errors, especially medical terms (drug names, anatomy, procedures, abbreviations).
2. Expand common medical abbreviations where appropriate (e.g. "bp" → "blood pressure", "sob" → "shortness of breath", "mi" → "myocardial infarction").
3. Correct obvious phonetic errors in medical terminology (e.g. "new monia" → "pneumonia").
4. Preserve the clinician's intent and phrasing style — do not paraphrase or add information.
5. Keep non-medical phrases as-is.

Respond ONLY with a JSON object in this exact format:
{
  "corrected": "<the corrected text>",
  "corrections": [
    { "original": "<original word/phrase>", "corrected": "<corrected form>", "reason": "<brief reason>" }
  ]
}
If there are no corrections, return an empty array for "corrections".`;

// ── Audio transcription via Groq Whisper Large V3 ─────────────────────────────
router.post(
  "/voice/transcribe",
  upload.single("audio"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No audio file uploaded" });
      return;
    }

    let groq: OpenAI;
    try {
      groq = getGroq();
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
      return;
    }

    try {
      const mime = req.file.mimetype || "audio/webm";
      // Groq accepts webm, mp4, ogg, wav, flac, m4a, mp3
      const ext =
        mime.includes("ogg")  ? "ogg"  :
        mime.includes("mp4")  ? "mp4"  :
        mime.includes("wav")  ? "wav"  :
        mime.includes("flac") ? "flac" :
        mime.includes("mp3")  ? "mp3"  : "webm";

      const audioFile = await toFile(req.file.buffer, `recording.${ext}`, { type: mime });

      // Language hint from query param — Groq/Whisper auto-detects if omitted
      const lang = (req.query.lang as string | undefined) ?? undefined;

      const transcription = await (groq.audio.transcriptions.create as Function)({
        file:     audioFile,
        model:    "whisper-large-v3",
        language: lang,            // ISO-639-1 code e.g. "en", "ar" — or omit for auto
        prompt:   "Medical dictation. Clinical terminology, drug names, anatomical terms, diagnoses.",
        response_format: "json",
        temperature: 0,
      });

      const transcript = (transcription.text ?? "").trim();
      res.json({ transcript });
    } catch (err) {
      const message = (err as Error).message ?? "Transcription failed";
      req.log.error({ err }, "Groq transcription error");
      res.status(500).json({ error: message });
    }
  }
);

// ── Text-only medical correction (AI fallback — local dict preferred) ─────────
router.post(
  "/voice/correct",
  express.json(),
  async (req, res): Promise<void> => {
    const text = (req.body?.text ?? "").toString().trim();
    if (!text) {
      res.json({ corrected: "", corrections: [] });
      return;
    }

    let openrouter: OpenAI;
    try {
      openrouter = getOpenRouter();
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
      return;
    }

    try {
      const completion = await openrouter.chat.completions.create({
        model:      OPENROUTER_MODEL,
        max_tokens: 8192,
        messages: [
          { role: "system", content: MEDICAL_SYSTEM_PROMPT },
          { role: "user",   content: text },
        ],
      });

      let corrected   = text;
      let corrections: Array<{ original: string; corrected: string; reason: string }> = [];

      const raw = completion.choices[0]?.message?.content ?? "{}";
      try {
        const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        const parsed = JSON.parse(clean);
        corrected   = parsed.corrected   ?? text;
        corrections = parsed.corrections ?? [];
      } catch { /* keep raw text */ }

      res.json({ corrected, corrections });
    } catch (err) {
      req.log.error({ err }, "Voice correction error");
      res.status(500).json({ error: (err as Error).message ?? "Correction failed" });
    }
  }
);

export default router;
