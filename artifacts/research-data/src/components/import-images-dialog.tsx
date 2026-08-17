import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Upload, Link, Loader2, Check, X } from "lucide-react";
import { getListPatientsQueryKey } from "@workspace/api-client-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  batchSize?: number;
};

type UploadFile = {
  file: File;
  detectedPatientId: string | null;
  isProcessing: boolean;
  error?: string;
};

const PATIENT_ID_PATTERNS = [
  /PAT(\d+)/i,
  /patient[_-]?(\d+)/i,
  /id[_-]?(\d+)/i,
  /(\d{5,})/,
];

function extractPatientIdFromFilename(filename: string): string | null {
  // Strip the file extension, then drop any "(1)"/"(2)" style suffixes BEFORE
  // extracting digits so "89373(1).png" resolves to 89373 (not 893731).
  const base = filename.replace(/\.[^/.]+$/, "");
  const name = base.replace(/\(\d+\)/g, "").replace(/[().]/g, "");
  for (const pattern of PATIENT_ID_PATTERNS) {
    const match = name.match(pattern);
    if (match?.[1]) {
      const digits = match[1].replace(/\D/g, '');
      if (digits.length >= 4) {
        return `PAT${digits}`;
      }
    }
  }
  return null;
}

export function ImportImagesDialog({ open, onOpenChange, batchSize = 5 }: Props) {
  const [tab, setTab] = useState<"upload" | "urls">("upload");
  const [urlInput, setUrlInput] = useState("");
  const [patientId, setPatientId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [currentBatch, setCurrentBatch] = useState<number>(0);
  const [uploadedCount, setUploadedCount] = useState<number>(0);
  const [failedCount, setFailedCount] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [files, setFiles] = useState<UploadFile[]>([]);

  const handleFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const newFiles = Array.from(selectedFiles).map(file => ({
      file,
      detectedPatientId: extractPatientIdFromFilename(file.name),
      isProcessing: false,
    }));
    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleFileUploads = async () => {
    if (files.length === 0) {
      toast({ title: "No files selected", description: "Please select image files to upload.", variant: "destructive" });
      return;
    }

    setUploading(true);
    setCurrentBatch(0);
    setUploadedCount(0);
    setFailedCount(0);
    const total = files.length;
    setTotalFiles(total);

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    // Process uploads SEQUENTIALLY to avoid race conditions with same-patient uploads
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      setCurrentBatch(i + 1);

      try {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(item.file);
        });
        const match = dataUrl.match(/^data:image\/[a-z]+;base64,(.+)$/i);
        const base64Data = match ? match[1] : dataUrl;

        const res = await fetch("/api/storage/upload-file", {
          method: "POST",
          headers: { "Content-Type": "application/json", credentials: "include" },
          body: JSON.stringify({
            patientId: item.detectedPatientId || undefined,
            filename: item.file.name,
            contentType: item.file.type,
            fileData: base64Data,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          failCount++;
          item.error = err.error || "Upload failed";
          errors.push(item.error!);
        } else {
          successCount++;
        }
      } catch {
        failCount++;
        item.error = "Network error";
        errors.push("Network error");
      }

      setUploadedCount(successCount);
      setFailedCount(failCount);
    }

    setUploading(false);
    setCurrentBatch(0);
    setTotalFiles(total);
    queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
    toast({
      title: "Upload Complete",
      description: `${successCount} file(s) uploaded${failCount > 0 ? `, ${failCount} failed` : ""}${errors.length > 0 ? ` - ${errors.slice(0,2).join("; ")}` : ""}`,
    });
    onOpenChange(false);
    setFiles([]);
    setUrlInput("");
  };

  const handleUrlImport = async () => {
    const urls = urlInput.split('\n').map(l => l.trim()).filter(l => l && (l.startsWith('http://') || l.startsWith('https://')));
    
    if (urls.length === 0) {
      toast({ title: "No valid URLs", description: "Please enter image URLs (one per line).", variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadedCount(urls.length);
    setCurrentBatch(1);
    setTotalFiles(1);

    try {
      const res = await fetch("/api/patients/batch-import-images", {
        method: "POST",
        headers: { "Content-Type": "application/json", credentials: "include" },
        body: JSON.stringify({ patientId: patientId.trim() || undefined, imageUrls: urls }),
      });
      const data = await res.json();

      if (res.ok) {
        const linked = data.results?.filter((r: any) => r.status === "linked").length ?? data.uploaded;
        const orphaned = data.results?.filter((r: any) => r.status === "orphaned").length ?? 0;
        toast({
          title: "Import Complete",
          description: `${linked} image(s) linked to patients${orphaned ? `, ${orphaned} not linked (no matching patient)` : ""}.`,
        });
        onOpenChange(false);
        setUrlInput("");
        setPatientId("");
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
      } else {
        toast({ title: "Import Failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Import Failed", description: "Network error", variant: "destructive" });
    }

    setUploading(false);
    setCurrentBatch(0);
    setUploadedCount(0);
    setFailedCount(0);
    setTotalFiles(0);
  };

  const clearFiles = () => {
    setFiles([]);
  };

  const progress = totalFiles > 0 ? Math.round((currentBatch / totalFiles) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Images</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Upload images or import from URLs. Patient IDs are auto-detected from filenames.
          </p>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab as any} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              Upload Files
            </TabsTrigger>
            <TabsTrigger value="urls" className="cursor-pointer">
              <Link className="w-4 h-4 mr-2" />
              Import from URLs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="flex-1 flex flex-col gap-4 mt-4">
            <div>
              <Input
                type="file"
                accept="image/*"
                multiple
                ref={fileInputRef}
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              
              <div 
                className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="font-medium mb-1">Click to select images</p>
                <p className="text-xs text-muted-foreground">Support multiple files (JPG, PNG, etc.)</p>
              </div>
            </div>

            {files.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                <h4 className="text-sm font-medium">Selected Files ({files.length})</h4>
                {files.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 border rounded bg-muted/20">
                    <div className="text-sm flex-1">
                      <span className="font-medium block truncate">{item.file.name}</span>
                      {item.detectedPatientId ? (
                        <span className="text-xs text-muted-foreground">Patient ID: <span className="font-mono bg-white px-1 rounded">{item.detectedPatientId}</span></span>
                      ) : (
                        <span className="text-xs text-amber-600">⚠ No patient ID detected</span>
                      )}
                    </div>
                    {item.error && (
                  <div className="text-xs text-destructive" title={item.error}>
                    <X className="w-4 h-4 inline" />
                    {item.error.length > 30 ? item.error.slice(0, 30) + "…" : item.error}
                  </div>
                )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={clearFiles}>
                  Clear All
                </Button>
              </div>
            )}

            {uploading && totalFiles > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Batch {currentBatch} of {totalFiles}</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <Button onClick={handleFileUploads} disabled={uploading || files.length === 0} className="w-full">
              {uploading
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Check className="w-4 h-4 mr-2" />
              }
              Upload {files.length} File{files.length !== 1 ? "s" : ""}
            </Button>
          </TabsContent>

          <TabsContent value="urls" className="flex-1 flex flex-col gap-4 mt-4">
            <div className="space-y-2">
              <Label>Patient ID (optional)</Label>
              <Input
                type="text"
                placeholder="e.g. 1404343 — applies to all URLs below"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                disabled={uploading}
              />
              <p className="text-xs text-muted-foreground">Leave blank to auto-detect each patient from the image filename.</p>
              <Label>Image URLs (one per line)</Label>
              <textarea
                placeholder="https://example.com/image1.png&#10;https://example.com/image2.jpg"
                className="w-full h-32 p-3 border rounded-md font-mono text-sm"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={uploading}
              />
              <p className="text-xs text-muted-foreground">Paste image URLs (one per line). Each image will be downloaded and stored.</p>
            </div>

            {uploading && totalFiles > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Importing…</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            <Button onClick={handleUrlImport} disabled={uploading || urlInput.trim() === ""} className="w-full">
              {uploading
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Link className="w-4 h-4 mr-2" />
              }
              Import URLs
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
            <Button variant="outline" onClick={() => { onOpenChange(false); setTab("upload"); setFiles([]); setUrlInput(""); setPatientId(""); setCurrentBatch(0); setUploadedCount(0); setFailedCount(0); setTotalFiles(0); }}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}