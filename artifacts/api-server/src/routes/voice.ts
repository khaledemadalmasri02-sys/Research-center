import { Router } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import express from "express";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB – Whisper's max
});

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

const MEDICAL_SYSTEM_PROMPT = `You are a medical transcription correction assistant.
The user will give you raw dictated text from a clinician. Your job is to:
1. Fix spelling errors, especially medical terms (drug names, anatomy, procedures, abbreviations).
2. Expand common medical abbreviations where appropriate (e.g. "bp" → "blood pressure", "sob" → "shortness of breath", "mi" → "myocardial infarction").
3. Correct obvious phonetic errors in medical terminology (e.g. "new monia" → "pneumonia", "tachycardia" if said incorrectly, etc.).
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

router.post(
  "/voice/transcribe",
  upload.single("audio"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No audio file uploaded" });
      return;
    }

    let openai: OpenAI;
    try {
      openai = getOpenAI();
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
      return;
    }

    try {
      // Detect MIME type from the upload (browser sends webm or ogg)
      const mime = req.file.mimetype || "audio/webm";
      const ext  = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "mp4" : "webm";

      const audioFile = await toFile(req.file.buffer, `recording.${ext}`, { type: mime });

      // ── 1. Transcribe with Whisper ────────────────────────────────────────
      const transcription = await openai.audio.transcriptions.create({
        file:   audioFile,
        model:  "whisper-1",
        prompt: "Medical dictation. Clinical terminology, drug names, anatomical terms, diagnoses.",
      });

      const transcript = transcription.text.trim();

      if (!transcript) {
        res.json({ transcript: "", corrected: "", corrections: [] });
        return;
      }

      // ── 2. Medical auto-correction with GPT-4o-mini ───────────────────────
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        max_tokens: 1024,
        messages: [
          { role: "system", content: MEDICAL_SYSTEM_PROMPT },
          { role: "user",   content: transcript },
        ],
      });

      let corrected   = transcript;
      let corrections: Array<{ original: string; corrected: string; reason: string }> = [];

      const raw = completion.choices[0]?.message?.content ?? "{}";
      try {
        const parsed = JSON.parse(raw);
        corrected   = parsed.corrected   ?? transcript;
        corrections = parsed.corrections ?? [];
      } catch {
        // If JSON parse fails, use raw transcript unchanged
      }

      res.json({ transcript, corrected, corrections });
    } catch (err) {
      const message = (err as Error).message ?? "Transcription failed";
      req.log.error({ err }, "Voice transcription error");
      res.status(500).json({ error: message });
    }
  }
);

// ── Text-only medical correction (used by live Web Speech API flow) ────────

router.post(
  "/voice/correct",
  express.json(),
  async (req, res): Promise<void> => {
    const text = (req.body?.text ?? "").toString().trim();
    if (!text) {
      res.json({ corrected: "", corrections: [] });
      return;
    }

    let openai: OpenAI;
    try {
      openai = getOpenAI();
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
      return;
    }

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        max_tokens: 1024,
        messages: [
          { role: "system", content: MEDICAL_SYSTEM_PROMPT },
          { role: "user",   content: text },
        ],
      });

      let corrected   = text;
      let corrections: Array<{ original: string; corrected: string; reason: string }> = [];

      const raw = completion.choices[0]?.message?.content ?? "{}";
      try {
        const parsed = JSON.parse(raw);
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
