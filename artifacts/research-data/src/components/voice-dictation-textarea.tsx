import { useRef, useState, useCallback, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2, X, ArrowDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Web Speech API types ───────────────────────────────────────────────────

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

type Correction = { original: string; corrected: string; reason: string };
type CorrectionResult = { corrected: string; corrections: Correction[] };

type Phase =
  | "idle"
  | "listening"          // live — text streaming into field
  | "correcting"         // GPT medical-correction pass running
  | "done";              // result ready, show badge strip

// ── Helpers ────────────────────────────────────────────────────────────────

function getSpeechRecognition(): SpeechRecognition | null {
  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous      = true;
  r.interimResults  = true;
  r.lang            = "en-US";
  r.maxAlternatives = 1;
  return r;
}

async function correctText(text: string): Promise<CorrectionResult> {
  const res = await fetch("/api/voice/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Correction failed (${res.status})`);
  return res.json();
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value:    string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
}

export function VoiceDictationTextarea({ value, onChange, className, ...rest }: Props) {
  const [phase,        setPhase]        = useState<Phase>("idle");
  const [interim,      setInterim]      = useState("");          // live partial sentence
  const [corrections,  setCorrections]  = useState<Correction[]>([]);
  const [error,        setError]        = useState<string | null>(null);

  // Track the field value at the moment recording started so we can
  // accurately append the dictated block without drift.
  const baseRef      = useRef("");
  // Accumulate finalised speech segments during this recording session.
  const finalRef     = useRef("");
  const recRef       = useRef<SpeechRecognition | null>(null);
  const stopCalledRef = useRef(false);

  // Emit value changes through onChange so react-hook-form stays in sync
  const emit = useCallback((next: string) => {
    onChange({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>);
  }, [onChange]);

  // ── Start listening ──────────────────────────────────────────────────────
  const start = useCallback(() => {
    setError(null);
    const rec = getSpeechRecognition();
    if (!rec) {
      setError("Your browser doesn't support live speech recognition. Try Chrome or Edge.");
      return;
    }

    baseRef.current   = value;
    finalRef.current  = "";
    stopCalledRef.current = false;
    recRef.current = rec;

    rec.onresult = (event) => {
      let interim_ = "";
      let newFinal = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i]![0]!.transcript;
        if (event.results[i]!.isFinal) {
          newFinal += t;
        } else {
          interim_ = t;
        }
      }

      if (newFinal) {
        // Add a space separator when appending after existing text
        const sep = finalRef.current || baseRef.current ? " " : "";
        finalRef.current += sep + newFinal.trim();
        setInterim("");
      } else {
        setInterim(interim_);
      }

      // Live-update the field: base + final + interim preview
      const preview = finalRef.current
        ? (interim_ ? `${finalRef.current} ${interim_}` : finalRef.current)
        : interim_;
      const sep = baseRef.current && preview ? " " : "";
      emit(baseRef.current + sep + preview);
    };

    rec.onerror = (event) => {
      if (event.error === "no-speech") return; // ignore silence
      if (event.error === "aborted")   return; // we stopped it
      setError(`Microphone error: ${event.error}`);
      cleanup();
    };

    rec.onend = () => {
      // If the recognition ended on its own (e.g. silence timeout) and the
      // user hasn't explicitly stopped, restart to keep it continuous.
      if (!stopCalledRef.current && recRef.current === rec) {
        try { rec.start(); } catch { /* ignore */ }
        return;
      }
      cleanup();
    };

    try {
      rec.start();
      setPhase("listening");
    } catch {
      setError("Could not start microphone. Check browser permissions.");
    }
  }, [value, emit]);

  // ── Stop + correct ───────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    stopCalledRef.current = true;
    recRef.current?.stop();
    recRef.current = null;
    setInterim("");

    // The final field value at this point is already updated via onresult.
    // Run the medical correction pass on just the dictated block.
    const dictated = finalRef.current.trim();
    if (!dictated) {
      setPhase("idle");
      return;
    }

    setPhase("correcting");
    try {
      const { corrected, corrections } = await correctText(dictated);
      // Replace the dictated block with the corrected version
      const sep = baseRef.current && corrected ? " " : "";
      emit(baseRef.current + sep + corrected);
      setCorrections(corrections);
      setPhase(corrections.length > 0 ? "done" : "idle");
    } catch {
      // Correction failed – keep the raw transcription, don't block the user
      setPhase("idle");
    }
  }, [emit]);

  function cleanup() {
    recRef.current = null;
    setPhase("idle");
    setInterim("");
  }

  function dismiss() {
    stopCalledRef.current = true;
    recRef.current?.stop();
    recRef.current = null;
    setPhase("idle");
    setInterim("");
    setCorrections([]);
    setError(null);
  }

  // Dismiss corrections panel when the field is edited manually
  const handleChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    if (phase === "done") setPhase("idle");
    onChange(e);
  };

  const isListening  = phase === "listening";
  const isCorrecting = phase === "correcting";
  const isDone       = phase === "done";

  return (
    <div className="space-y-1.5">
      {/* Textarea row */}
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

        {/* Mic button */}
        <button
          type="button"
          disabled={isCorrecting}
          onClick={isListening ? stop : start}
          title={isListening ? "Stop — run medical correction" : "Start live voice dictation"}
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
            Listening…
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
