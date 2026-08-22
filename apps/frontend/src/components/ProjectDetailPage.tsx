import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import axios from "axios";
import { BACKEND_URL } from "@/lib/config";
import { Button } from "./ui/button";
import { UploadDialog } from "./UploadDialog";
import {
  ChevronLeft,
  Trash2,
  Upload,
  Mic,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
} from "lucide-react";

interface Document {
  id: string;
  name: string;
  knowledgeSourceType: string;
  processingStatus: "UPLOADED" | "PROCESSING" | "PROCESSED" | "FAILED";
  fileSize: number;
  mimeType: string;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  technologies: string[];
  documents: Document[];
}

function StatusBadge({ status }: { status: Document["processingStatus"] }) {
  if (status === "PROCESSED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="size-3" /> Processed
      </span>
    );
  if (status === "PROCESSING")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
        <Loader2 className="size-3 animate-spin" /> Processing
      </span>
    );
  if (status === "FAILED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <AlertCircle className="size-3" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Clock className="size-3" /> Uploaded
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [interviewError, setInterviewError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchProject() {
    try {
      const r = await axios.get(`${BACKEND_URL}/api/projects/${id}`);
      setProject(r.data);
    } catch (e: any) {
      if (e?.response?.status === 404) setNotFound(true);
    }
  }

  useEffect(() => {
    fetchProject().finally(() => setLoading(false));
  }, [id]);

  // Poll while any document is still processing
  useEffect(() => {
    if (!project) return;
    const hasProcessing = project.documents.some((d) => d.processingStatus === "PROCESSING" || d.processingStatus === "UPLOADED");
    if (hasProcessing) {
      pollRef.current = setInterval(fetchProject, 3000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [project]);

  async function handleDeleteDoc(docId: string) {
    try {
      await axios.delete(`${BACKEND_URL}/api/documents/${docId}`);
      setProject((prev) =>
        prev ? { ...prev, documents: prev.documents.filter((d) => d.id !== docId) } : prev
      );
    } catch (e) {
      console.error(e);
    }
  }

  function handleStartInterview() {
    const processed = project?.documents.filter((d) => d.processingStatus === "PROCESSED").length ?? 0;
    if (processed === 0) {
      setInterviewError(
        "No processed documents yet. Wait for at least one document to finish processing."
      );
      return;
    }
    navigate(`/interview/new?type=PROJECT&projectId=${id}`);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="text-lg font-medium">Project not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/projects")}>
          Back to projects
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      {/* Back */}
      <button
        onClick={() => navigate("/projects")}
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Projects
      </button>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
        )}
        {project.technologies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {project.technologies.map((t) => (
              <span
                key={t}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="mb-6 flex items-center gap-3">
        <Button variant="outline" className="gap-2" onClick={() => setUploadOpen(true)}>
          <Upload className="size-4" />
          Upload Document
        </Button>
        <div className="flex flex-col">
          <Button className="gap-2" onClick={handleStartInterview}>
            <Mic className="size-4" />
            Start Project Interview
          </Button>
          {interviewError && (
            <p className="mt-1 text-xs text-destructive">{interviewError}</p>
          )}
        </div>
      </div>

      {/* Documents */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Documents ({project.documents.length})
        </h2>

        {project.documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <FileText className="mx-auto mb-2 size-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No documents yet.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setUploadOpen(true)}>
              Upload your first document
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {project.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.knowledgeSourceType.replace(/_/g, " ")} · {formatBytes(doc.fileSize)}
                  </p>
                </div>
                <StatusBadge status={doc.processingStatus} />
                <button
                  onClick={() => handleDeleteDoc(doc.id)}
                  className="ml-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        defaultProjectId={id}
        onSuccess={() => {
          setUploadOpen(false);
          fetchProject();
        }}
      />
    </div>
  );
}
