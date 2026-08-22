import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import axios from "axios";
import { BACKEND_URL } from "@/lib/config";
import { Button } from "./ui/button";
import { UploadDialog } from "./UploadDialog";
import {
  FolderOpen,
  FileText,
  Upload,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  description: string | null;
  technologies: string[];
  documentCount: number;
}

interface Document {
  id: string;
  name: string;
  knowledgeSourceType: string;
  processingStatus: "UPLOADED" | "PROCESSING" | "PROCESSED" | "FAILED";
  fileSize: number;
  projectId: string | null;
}

function StatusBadge({ status }: { status: Document["processingStatus"] }) {
  if (status === "PROCESSED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
        <CheckCircle2 className="size-3" /> Processed
      </span>
    );
  if (status === "PROCESSING")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
        <Loader2 className="size-3 animate-spin" /> Processing
      </span>
    );
  if (status === "FAILED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
        <AlertCircle className="size-3" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <Clock className="size-3" /> Uploaded
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchAll() {
    const [pRes, dRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/projects`),
      axios.get(`${BACKEND_URL}/api/documents`),
    ]);
    setProjects(pRes.data);
    setDocuments(dRes.data);
  }

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, []);

  // Poll while any doc is processing
  useEffect(() => {
    const hasProcessing = documents.some(
      (d) => d.processingStatus === "PROCESSING" || d.processingStatus === "UPLOADED"
    );
    if (hasProcessing) {
      pollRef.current = setInterval(() => axios.get(`${BACKEND_URL}/api/documents`).then((r) => setDocuments(r.data)), 5000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [documents]);

  const generalDocs = documents.filter((d) => !d.projectId);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All your uploaded projects and documents.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="gap-2">
          <Upload className="size-4" />
          Upload Document
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {/* Projects section */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Projects
            </h2>
            {projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <FolderOpen className="mx-auto mb-2 size-7 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No projects yet.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate("/projects")}
                >
                  Create a project
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-col rounded-xl border border-border bg-card/60 p-5"
                  >
                    <h3 className="font-semibold">{p.name}</h3>
                    {p.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {p.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.technologies.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                        >
                          {t}
                        </span>
                      ))}
                      {p.technologies.length > 4 && (
                        <span className="text-xs text-muted-foreground">
                          +{p.technologies.length - 4}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {p.documentCount} document{p.documentCount !== 1 ? "s" : ""}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 gap-1.5"
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      Open Project
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* General Documents section */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              General Documents
            </h2>
            {generalDocs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <FileText className="mx-auto mb-2 size-7 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No general documents yet. Upload a resume or notes to get started.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setUploadOpen(true)}
                >
                  Upload document
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border">
                {generalDocs.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.knowledgeSourceType.replace(/_/g, " ")} · {formatBytes(d.fileSize)}
                      </p>
                    </div>
                    <StatusBadge status={d.processingStatus} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => {
          setUploadOpen(false);
          fetchAll();
        }}
      />
    </div>
  );
}
