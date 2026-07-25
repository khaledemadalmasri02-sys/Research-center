import { useRef, useState, useCallback, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Square, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { correctMedicalText, type Correction } from "@/lib/medical-correction";

// ── Language options ───────────────────────────────────────────────────────────
// Groq Whisper auto-detects language — these are ISO-639-1 hints sent as a param.

type LangOption = { code: string; whisper: string; label: string; short: string };

const LANG_OPTIONS: LangOption[] = [
  { code: "auto", whisper: "",    label: "Auto-detect", short: "AUTO" },
  { code: "en",   whisper: "en",  label: "English",     short: "EN"   },
  { code: "ar",   whisper: "ar",  label: "Arabic",      short: "AR"   },
  { code: "fr",   whisper: "fr",  label: "French",      short: "FR"   },
  { code: "de",   whisper: "de",  label: "German",      short: "DE"   },
  { code: "es",   whisper: "es",  label: "Spanish",     short: "ES"   },
];

// ── Types ──────────────────────────────────────────────────────────────────────

type Phase = "idle" | "recording" | "transcribing" | "done";

// ── Recording timer ────────────────────────────────────────────────────────────

function useTimer(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) { setSeconds(0); return; }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getBestMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value:    string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
}

export function VoiceDictationTextarea({ value, onChange, className, ...rest }: Props) {
  const [phase,       setPhase]       = useState<Phase>("idle");
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [error,       setError]       = useState<string | null>(null);
  const [lang,        setLang]        = useState<LangOption>(LANG_OPTIONS[0]!);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const baseRef     = useRef("");           // field value when recording started
  const mimeRef     = useRef("");

  const timer = useTimer(phase === "recording");

  const emit = useCallback((next: string) => {
    onChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
  }, [onChange]);

  // ── Start recording ──────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    setError(null);
    setCorrections([]);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg = (err as Error).name === "NotAllowedError"
        ? "Microphone access denied. Allow microphone in your browser settings."
        : `Microphone error: ${(err as Error).message}`;
      setError(msg);
      return;
    }

    const mime = getBestMimeType();
    mimeRef.current   = mime;
    chunksRef.current = [];
    baseRef.current   = value.trimEnd();

    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      // Stop all tracks so the mic indicator disappears
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      chunksRef.current = [];

      if (blob.size < 1000) {
        // Too short — nothing recorded
        setPhase("idle");
        return;
      }

      setPhase("transcribing");
      try {
        const fd = new FormData();
        fd.append("audio", blob, "recording" + (mimeRef.current.includes("ogg") ? ".ogg" : mimeRef.current.includes("mp4") ? ".mp4" : ".webm"));

        const url = lang.whisper
          ? `/api/voice/transcribe?lang=${lang.whisper}`
          : "/api/voice/transcribe";

        const res = await fetch(url, {
          method:      "POST",
          credentials: "include",
          body:        fd,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const { transcript } = await res.json() as { transcript: string };

        if (!transcript.trim()) {
          setPhase("idle");
          return;
        }

        // Apply local medical correction — instant, no API cost
        const { corrected, corrections: fixes } = correctMedicalText(transcript);
        const base = baseRef.current;
        emit((base ? base + " " : "") + corrected);
        setCorrections(fixes);
        setPhase(fixes.length > 0 ? "done" : "idle");
      } catch (err) {
        setError(`Transcription failed: ${(err as Error).message}`);
        setPhase("idle");
      }
    };

    recorder.start(250); // collect chunks every 250 ms
    setPhase("recording");
  }, [value, emit, lang]);

  // ── Stop recording ────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  function dismiss() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setPhase("idle");
    setCorrections([]);
    setError(null);
  }

  const handleChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    if (phase === "done") setPhase("idle");
    onChange(e);
  };

  const isRecording    = phase === "recording";
  const isTranscribing = phase === "transcribing";
  const isDone         = phase === "done";
  const busy           = isRecording || isTranscribing;

  return (
    <div className="space-y-1.5">

      {/* Language selector — hidden while busy */}
      {!busy && (
        <div className="flex items-center gap-1 flex-wrap">
          {LANG_OPTIONS.map((opt) => (
            <button
              key={opt.code}
              type="button"
              onClick={() => setLang(opt)}
              title={opt.label}
              className={cn(
                "text-xs px-2 py-0.5 rounded border transition-colors",
                lang.code === opt.code
                  ? "bg-teal-600 text-white border-teal-600 font-semibold"
                  : "bg-muted text-muted-foreground border-border hover:border-teal-400 hover:text-teal-700"
              )}
            >
              {opt.short}
            </button>
          ))}
          <span className="text-xs text-muted-foreground ml-1">language</span>
        </div>
      )}

      {/* Textarea + mic / stop button */}
      <div className="relative group">
        <Textarea
          {...rest}
          value={value}
          onChange={handleChange}
          className={cn(
            "pr-10 min-h-[80px] transition-all resize-y",
            isRecording    && "ring-2 ring-red-400 border-red-300",
            isTranscribing && "ring-2 ring-amber-300 border-amber-200",
            className
          )}
        />

        <button
          type="button"
          disabled={isTranscribing}
          onClick={isRecording ? stop : start}
          title={
            isRecording    ? "Stop recording" :
            isTranscribing ? "Transcribing…"  :
            `Start voice dictation (${lang.label})`
          }
          className={cn(
            "absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center",
            "transition-all shadow-sm opacity-50 group-hover:opacity-100 focus:opacity-100",
            isRecording
              ? "bg-red-500 text-white opacity-100 shadow-md shadow-red-200 animate-pulse"
              : isTranscribing
              ? "bg-amber-400 text-white opacity-100 cursor-not-allowed"
              : "bg-teal-600 text-white hover:bg-teal-700"
          )}
        >
          {isTranscribing
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : isRecording
            ? <Square  className="w-3.5 h-3.5 fill-white" />
            : <Mic     className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-600 select-none">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="flex-1 font-mono">{timer}</span>
          <span className="text-red-400">
            Recording [{lang.short}] — click ■ to stop
          </span>
        </div>
      )}

      {/* Transcribing indicator */}
      {isTranscribing && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          Transcribing with Groq Whisper…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-destructive/10 border border-destructive/30 rounded-md text-xs text-destructive">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="w-3.5 h-3.5 hover:opacity-70" />
          </button>
        </div>
      )}

      {/* Corrections strip */}
      {isDone && corrections.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-teal-50 border border-teal-200 rounded-md text-xs">
          <span className="text-teal-700 font-medium shrink-0">Auto-corrected:</span>
          {corrections.map((c, i) => (
            <span
              key={i}
              title={c.reason}
              className="inline-flex items-center gap-1 bg-white border border-amber-200 text-amber-800 rounded-full px-2 py-0.5 cursor-help"
            >
              <span className="line-through text-red-400">{c.original}</span>
              <span className="text-muted-foreground mx-0.5">→</span>
              <span className="text-teal-700 font-medium">{c.corrected}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={dismiss}
            className="ml-auto text-muted-foreground hover:text-foreground shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
