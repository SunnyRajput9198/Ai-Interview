import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "@/lib/config";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { X, Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const KNOWLEDGE_SOURCE_TYPES = [
  "RESUME",
  "PROJECT",
  "ARCHITECTURE",
  "TECHNICAL_NOTES",
  "API_DOCUMENTATION",
  "DATABASE_DOCUMENTATION",
  "DEPLOYMENT",
  "INTERVIEW_PREPARATION",
  "OTHER",
] as const;

type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

// Types that show project selector
const PROJECT_TYPES = new Set<KnowledgeSourceType>([
  "PROJECT",
  "ARCHITECTURE",
  "API_DOCUMENTATION",
  "DATABASE_DOCUMENTATION",
  "DEPLOYMENT",
]);

interface Project {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
  onSuccess?: (documentId: string) => void;
}

type UploadState = "idle" | "uploading" | "polling" | "done" | "failed";

export function UploadDialog({ open, onClose, defaultProjectId, onSuccess }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>("OTHER");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [description, setDescription] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [docId, setDocId] = useState<string>("");
  const [error, setError] = useState("");

  const MAX_SIZE_MB = 20;
  const showProjectSelector = PROJECT_TYPES.has(sourceType);

  useEffect(() => {
    if (open) {
      axios
        .get(`${BACKEND_URL}/api/projects`)
        .then((r) => setProjects(r.data))
        .catch(console.error);
    }
  }, [open]);

  useEffect(() => {
    if (defaultProjectId) setProjectId(defaultProjectId);
  }, [defaultProjectId]);

  // Poll processing status after upload
  useEffect(() => {
    if (uploadState !== "polling" || !docId) return;

    const interval = setInterval(async () => {
      try {
        const r = await axios.get(`${BACKEND_URL}/api/documents/${docId}`);
        const status: string = r.data.processingStatus;
        setProcessingStatus(status);
        if (status === "PROCESSED" || status === "FAILED") {
          clearInterval(interval);
          setUploadState(status === "PROCESSED" ? "done" : "failed");
          if (status === "PROCESSED") onSuccess?.(docId);
        }
      } catch {
        clearInterval(interval);
        setUploadState("failed");
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [uploadState, docId, onSuccess]);

  function resetForm() {
    setFile(null);
    setSourceType("OTHER");
    setProjectId(defaultProjectId ?? "");
    setDescription("");
    setUploadState("idle");
    setProcessingStatus("");
    setDocId("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleUpload() {
    if (!file) { setError("Please select a file."); return; }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File exceeds the ${MAX_SIZE_MB} MB limit.`);
      return;
    }

    setError("");
    setUploadState("uploading");

    const fd = new FormData();
    fd.append("file", file);
    fd.append("knowledgeSourceType", sourceType);
    if (showProjectSelector && projectId) fd.append("projectId", projectId);
    if (description.trim()) fd.append("description", description.trim());

    try {
      const r = await axios.post(`${BACKEND_URL}/api/documents`, fd);
      setDocId(r.data.id);
      setProcessingStatus("UPLOADED");
      setUploadState("polling");
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Upload failed. Please try again.");
      setUploadState("idle");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">Upload Document</h2>
          <button
            onClick={handleClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {uploadState === "done" ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="size-10 text-emerald-400" />
            <p className="font-medium">Document processed successfully</p>
            <Button onClick={handleClose}>Done</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* File */}
            <div>
              <Label className="mb-1.5 block text-sm">File</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md,.docx"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError("");
                }}
                disabled={uploadState !== "idle"}
                className="cursor-pointer"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Accepted: PDF, TXT, MD, DOCX · Max {MAX_SIZE_MB} MB
              </p>
            </div>

            {/* Type */}
            <div>
              <Label className="mb-1.5 block text-sm">Document Type</Label>
              <Select
                value={sourceType}
                onValueChange={(v) => setSourceType(v as KnowledgeSourceType)}
                disabled={uploadState !== "idle"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_SOURCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Project (conditional) */}
            {showProjectSelector && (
              <div>
                <Label className="mb-1.5 block text-sm">Project (optional)</Label>
                <Select
                  value={projectId || "__none__"}
                  onValueChange={(v) => setProjectId(v === "__none__" ? "" : v)}
                  disabled={uploadState !== "idle"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Description */}
            <div>
              <Label className="mb-1.5 block text-sm">Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this document…"
                rows={2}
                disabled={uploadState !== "idle"}
              />
            </div>

            {/* Error */}
            {error && (
              <p className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                {error}
              </p>
            )}

            {/* Processing status */}
            {(uploadState === "uploading" || uploadState === "polling") && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                <Loader2 className="size-3.5 animate-spin" />
                {uploadState === "uploading"
                  ? "Uploading…"
                  : `Processing… (${processingStatus})`}
              </div>
            )}

            {uploadState === "failed" && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-3.5" />
                Processing failed. You can reprocess from the document list.
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleClose} disabled={uploadState === "uploading"}>
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={uploadState !== "idle" || !file}
                className="gap-2"
              >
                {uploadState === "uploading" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
