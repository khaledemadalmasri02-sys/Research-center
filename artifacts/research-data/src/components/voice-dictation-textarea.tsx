import { useRef, useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Loader2, CheckCheck, X, RotateCcw, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type Correction = {
  original:  string;
  corrected: string;
  reason:    string;
};

type TranscribeResult = {
  transcript:  string;
  corrected:   string;
  corrections: Correction[];
};

type State =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "processing" }
  | { kind: "result"; result: TranscribeResult }
  | { kind: "error"; message: string };

// ── Hook ───────────────────────────────────────────────────────────────────

function useVoiceDictation(onText: (text: string, mode: "append" | "replace") => void) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
        MediaRecorder.isTypeSupported("audio/webm")             ? "audio/webm" :
        MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")  ? "audio/ogg;codecs=opus" :
                                                                   "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob     = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        chunksRef.current = [];
        setState({ kind: "processing" });
        await transcribe(blob, mimeType || "audio/webm");
      };

      recorder.start(250);
      recorderRef.current = recorder;
      setState({ kind: "recording" });
    } catch (err) {
      setState({ kind: "error", message: "Microphone access denied. Please allow microphone access." });
    }
  }, []);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const transcribe = async (blob: Blob, mimeType: string) => {
    try {
      const form = new FormData();
      const ext  = mimeType.includes("ogg") ? "ogg" : "webm";
      form.append("audio", blob, `recording.${ext}`);

      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        body:   form,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        setState({ kind: "error", message: err.error ?? "Transcription failed" });
        return;
      }

      const data: TranscribeResult = await res.json();

      if (!data.transcript) {
        setState({ kind: "error", message: "No speech detected. Please try again." });
        return;
      }

      setState({ kind: "result", result: data });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  };

  const accept = useCallback((text: string, mode: "append" | "replace") => {
    onText(text, mode);
    setState({ kind: "idle" });
  }, [onText]);

  const dismiss = useCallback(() => {
    if (state.kind === "recording") stopRecording();
    setState({ kind: "idle" });
  }, [state.kind, stopRecording]);

  return { state, startRecording, stopRecording, accept, dismiss };
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value:    string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
}

export function VoiceDictationTextarea({ value, onChange, className, ...rest }: Props) {
  const handleText = useCallback((text: string, mode: "append" | "replace") => {
    const next = mode === "append"
      ? (value ? `${value.trimEnd()}\n${text}` : text)
      : text;
    const ev = { target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>;
    onChange(ev);
  }, [value, onChange]);

  const { state, startRecording, stopRecording, accept, dismiss } = useVoiceDictation(handleText);

  const toggleRecording = () => {
    if (state.kind === "recording") stopRecording();
    else if (state.kind === "idle" || state.kind === "error") startRecording();
  };

  const isRecording  = state.kind === "recording";
  const isProcessing = state.kind === "processing";
  const isBusy       = isRecording || isProcessing;
  const hasResult    = state.kind === "result";
  const hasError     = state.kind === "error";

  return (
    <div className="relative space-y-1.5">
      {/* Textarea + mic button */}
      <div className="relative group">
        <Textarea
          {...rest}
          value={value}
          onChange={onChange}
          className={cn(
            "pr-10 min-h-[80px] transition-all",
            isRecording && "ring-2 ring-red-400 border-red-300",
            className
          )}
        />

        {/* Mic toggle */}
        <button
          type="button"
          onClick={toggleRecording}
          disabled={isProcessing}
          title={isRecording ? "Stop recording" : "Start voice dictation"}
          className={cn(
            "absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm",
            "opacity-60 group-hover:opacity-100 focus:opacity-100",
            isRecording
              ? "bg-red-500 text-white opacity-100 animate-pulse shadow-red-200 shadow-md"
              : isProcessing
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-teal-600 text-white hover:bg-teal-700"
          )}
        >
          {isProcessing
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : isRecording
            ? <MicOff className="w-3.5 h-3.5" />
            : <Mic className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-600">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Recording… click the mic button to stop
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-50 border border-teal-200 rounded-md text-xs text-teal-700">
          <Loader2 className="w-3 h-3 animate-spin" />
          Transcribing and correcting medical terminology…
        </div>
      )}

      {/* Error */}
      {hasError && state.kind === "error" && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-destructive/10 border border-destructive/30 rounded-md text-xs text-destructive">
          <span>{state.message}</span>
          <button type="button" onClick={dismiss} className="shrink-0 hover:opacity-70">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Result panel */}
      {hasResult && state.kind === "result" && (
        <div className="border border-teal-200 bg-teal-50/60 rounded-lg p-3 space-y-3 text-sm shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-teal-800 uppercase tracking-wide flex items-center gap-1.5">
              <Mic className="w-3 h-3" /> Voice Result
            </span>
            <button type="button" onClick={dismiss} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Corrected text */}
          <div className="bg-white border border-teal-100 rounded-md p-2.5 text-sm leading-relaxed text-foreground">
            {state.result.corrected}
          </div>

          {/* Corrections diff */}
          {state.result.corrections.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Auto-corrections applied:</p>
              <div className="flex flex-wrap gap-1.5">
                {state.result.corrections.map((c, i) => (
                  <span
                    key={i}
                    title={c.reason}
                    className="inline-flex items-center gap-1 text-xs bg-white border border-amber-200 text-amber-800 rounded-full px-2 py-0.5"
                  >
                    <span className="line-through text-red-400">{c.original}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-teal-700 font-medium">{c.corrected}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Raw transcript (if different) */}
          {state.result.transcript !== state.result.corrected && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                Show raw transcript
              </summary>
              <p className="mt-1 text-muted-foreground italic pl-2 border-l border-muted">
                {state.result.transcript}
              </p>
            </details>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              className="flex-1 h-8 text-xs bg-teal-600 hover:bg-teal-700"
              onClick={() => accept(state.result.corrected, "append")}
            >
              <ArrowDown className="w-3 h-3 mr-1" /> Append to field
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs border-teal-300 text-teal-700 hover:bg-teal-50"
              onClick={() => accept(state.result.corrected, "replace")}
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Replace field
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => accept(state.result.transcript, "append")}
              title="Use the raw transcript without medical corrections"
            >
              Raw
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
