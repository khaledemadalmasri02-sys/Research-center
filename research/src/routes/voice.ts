import type { Context } from "hono";

interface SessionData {
  authenticated: boolean;
  username?: string;
}

export const voiceHandlers = {
  TRANSCRIBE: async (c: Context) => {
    try {
      const session = c.get("session") as SessionData | null;
      if (!session?.authenticated) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const apiKey = (c.env as any).GROQ_API_KEY as string | undefined;
      if (!apiKey) {
        return c.json(
          { error: "Voice transcription is not configured (missing GROQ_API_KEY)." },
          501
        );
      }

      const formData = await c.req.parseBody({ all: true });
      const audio = formData["audio"];
      if (!audio || typeof audio === "string") {
        return c.json({ error: "No audio file provided" }, 400);
      }

      const lang = c.req.query("lang");

      const groqForm = new FormData();
      groqForm.append("file", audio as File | Blob, "recording.webm");
      groqForm.append("model", "whisper-large-v3");
      groqForm.append("response_format", "json");
      if (lang) groqForm.append("language", lang);

      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: groqForm,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("Groq transcription failed:", res.status, text.slice(0, 300));
        return c.json({ error: "Transcription service error" }, 502);
      }

      const data = (await res.json()) as { text?: string };
      const transcript = (data.text || "").trim();
      return c.json({ transcript });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      return c.json({ error: "Failed to transcribe audio" }, 500);
    }
  },
};
