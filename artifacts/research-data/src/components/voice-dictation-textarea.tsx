import { useRef, useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Web Speech API types ───────────────────────────────────────────────────

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

// ── Language options ───────────────────────────────────────────────────────

type LangOption = { code: string; label: string; short: string };

const LANG_OPTIONS: LangOption[] = [
  { code: "en-US", label: "English",        short: "EN" },
  { code: "ar-SA", label: "Arabic (SA)",    short: "AR" },
  { code: "ar-EG", label: "Arabic (EG)",    short: "AR-EG" },
];

// ── Types ──────────────────────────────────────────────────────────────────

type Correction = { original: string; corrected: string; reason: string };
type Phase =
  | "idle"
  | "listening"
  | "correcting"
  | "done";

// ── Helpers ────────────────────────────────────────────────────────────────

function getSpeechRecognition(lang: string): SpeechRecognition | null {
  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous      = true;
  r.interimResults  = true;
  r.lang            = lang;
  r.maxAlternatives = 3;      // give browser more candidates to pick from
  return r;
}

/** Pick the highest-confidence alternative from a SpeechRecognitionResult. */
function bestTranscript(result: SpeechRecognitionResult): string {
  let best = "";
  let bestConf = -1;
  for (let i = 0; i < result.length; i++) {
    const alt = result[i]!;
    if (alt.confidence > bestConf) {
      bestConf = alt.confidence;
      best     = alt.transcript;
    }
  }
  return best || result[0]!.transcript;
}

async function correctText(text: string): Promise<{ corrected: string; corrections: Correction[] }> {
  const res = await fetch("/api/voice/correct", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value:    string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
}

export function VoiceDictationTextarea({ value, onChange, className, ...rest }: Props) {
  const [phase,       setPhase]       = useState<Phase>("idle");
  const [interim,     setInterim]     = useState("");
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [error,       setError]       = useState<string | null>(null);
  const [lang,        setLang]        = useState<string>("en-US");

  // Snapshot of the field value the moment recording started
  const baseRef      = useRef("");
  // Finalised segments accumulated during this session
  const finalRef     = useRef("");
  const recRef       = useRef<SpeechRecognition | null>(null);
  const stopCalledRef = useRef(false);

  const emit = useCallback((next: string) => {
    onChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
  }, [onChange]);

  // Build the live preview text shown in the field
  const liveValue = useCallback((interimText: string) => {
    const base     = baseRef.current;
    const finalized = finalRef.current;
    const parts: string[] = [];
    if (base)      parts.push(base);
    if (finalized) parts.push(finalized);
    if (interimText) parts.push(interimText);
    return parts.join(" ");
  }, []);

  // ── Start listening ──────────────────────────────────────────────────────
  const start = useCallback(() => {
    setError(null);
    setCorrections([]);

    const rec = getSpeechRecognition(lang);
    if (!rec) {
      setError("Your browser doesn't support speech recognition. Try Chrome or Edge.");
      return;
    }

    baseRef.current       = value.trimEnd();
    finalRef.current      = "";
    stopCalledRef.current = false;
    recRef.current        = rec;

    rec.onresult = (event) => {
      // Process only newly arrived results (from resultIndex onward)
      let newFinal  = "";
      let newInterim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const text   = bestTranscript(result).trim();
        if (result.isFinal) {
          newFinal += (newFinal ? " " : "") + text;
        } else {
          newInterim = text; // interim is always the last/only non-final
        }
      }

      if (newFinal) {
        finalRef.current  = finalRef.current
          ? finalRef.current + " " + newFinal
          : newFinal;
        setInterim("");
        emit(liveValue(""));
      } else if (newInterim) {
        setInterim(newInterim);
        emit(liveValue(newInterim));
      }
    };

    rec.onerror = (event) => {
      if (event.error === "no-speech") return;   // silence — keep waiting
      if (event.error === "aborted")   return;   // we triggered this
      setError(`Microphone error: ${event.error}`);
      recRef.current = null;
      setPhase("idle");
      setInterim("");
    };

    rec.onend = () => {
      // Auto-restart on silence timeout unless the user explicitly stopped
      if (!stopCalledRef.current && recRef.current === rec) {
        try { rec.start(); } catch { /* ignore race */ }
        return;
      }
      recRef.current = null;
      setInterim("");
      setPhase("idle");
    };

    try {
      rec.start();
      setPhase("listening");
    } catch {
      setError("Could not start microphone. Check browser permissions.");
    }
  }, [value, emit, lang, liveValue]);

  // ── Stop + optional AI correction ────────────────────────────────────────
  const stop = useCallback(async () => {
    stopCalledRef.current = true;
    recRef.current?.stop();
    recRef.current = null;
    setInterim("");

    const dictated = finalRef.current.trim();
    if (!dictated) {
      setPhase("idle");
      return;
    }

    // Commit what we have immediately so the user isn't waiting with a blank field
    emit(liveValue(""));

    setPhase("correcting");
    try {
      const { corrected, corrections } = await correctText(dictated);
      const base = baseRef.current;
      emit((base ? base + " " : "") + corrected);
      setCorrections(corrections);
      setPhase(corrections.length > 0 ? "done" : "idle");
    } catch {
      // Correction unavailable (no API key or network error) — keep raw text
      setPhase("idle");
    }
  }, [emit, liveValue]);

  function dismiss() {
    stopCalledRef.current = true;
    recRef.current?.stop();
    recRef.current = null;
    setPhase("idle");
    setInterim("");
    setCorrections([]);
    setError(null);
  }

  const handleChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    if (phase === "done") setPhase("idle");
    onChange(e);
  };

  const isListening  = phase === "listening";
  const isCorrecting = phase === "correcting";
  const isDone       = phase === "done";

  return (
    <div className="space-y-1.5">

      {/* Language selector — shown only when idle */}
      {!isListening && !isCorrecting && (
        <div className="flex items-center gap-1">
          {LANG_OPTIONS.map((opt) => (
            <button
              key={opt.code}
              type="button"
              onClick={() => setLang(opt.code)}
              title={opt.label}
              className={cn(
                "text-xs px-2 py-0.5 rounded border transition-colors",
                lang === opt.code
                  ? "bg-teal-600 text-white border-teal-600 font-semibold"
                  : "bg-muted text-muted-foreground border-border hover:border-teal-400 hover:text-teal-700"
              )}
            >
              {opt.short}
            </button>
          ))}
          <span className="text-xs text-muted-foreground ml-1">recognition language</span>
        </div>
      )}

      {/* Textarea + mic button */}
      <div className="relative group">
        <Textarea
          {...rest}
          value={value}
          onChange={handleChange}
          className={cn(
            "pr-10 min-h-[80px] transition-all resize-y",
            isListening  && "ring-2 ring-red-400 border-red-300",
            isCorrecting && "ring-2 ring-amber-300 border-amber-200",
            className
          )}
        />

        <button
          type="button"
          disabled={isCorrecting}
          onClick={isListening ? stop : start}
          title={isListening ? "Stop recording" : `Start voice dictation (${LANG_OPTIONS.find(o => o.code === lang)?.label ?? lang})`}
          className={cn(
            "absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center",
            "transition-all shadow-sm opacity-50 group-hover:opacity-100 focus:opacity-100",
            isListening
              ? "bg-red-500 text-white opacity-100 shadow-md shadow-red-200 animate-pulse"
              : isCorrecting
              ? "bg-amber-400 text-white opacity-100 cursor-not-allowed"
              : "bg-teal-600 text-white hover:bg-teal-700"
          )}
        >
          {isCorrecting
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : isListening
            ? <MicOff className="w-3.5 h-3.5" />
            : <Mic className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Live indicator */}
      {isListening && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-600 select-none">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="flex-1">
            Listening
            <span className="ml-1 font-medium text-red-500">
              [{LANG_OPTIONS.find(o => o.code === lang)?.short ?? lang}]
            </span>
            {interim && <span className="text-red-400 italic ml-1">"{interim}"</span>}
          </span>
          <span className="text-red-400">Click mic to stop</span>
        </div>
      )}

      {/* Correcting indicator */}
      {isCorrecting && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          Checking medical terminology…
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
