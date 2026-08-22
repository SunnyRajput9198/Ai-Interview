import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import axios from "axios";
import { BACKEND_URL } from "@/lib/config";
import { Button } from "./ui/button";
import {
  FolderOpen,
  FileText,
  CheckCircle2,
  Mic,
  ArrowRight,
  ChevronRight,
} from "lucide-react";

interface DashboardData {
  projectCount: number;
  documentCount: number;
  processedCount: number;
  recentProjects: {
    id: string;
    name: string;
    technologies: string[];
    documentCount: number;
  }[];
  recentGeneralDocs: {
    id: string;
    name: string;
    knowledgeSourceType: string;
    processingStatus: string;
    fileSize: number;
  }[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get(`${BACKEND_URL}/api/dashboard`)
      .then((r) => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your interview preparation at a glance.
          </p>
        </div>
        <Button onClick={() => navigate("/interview/new")} className="gap-2">
          <Mic className="size-4" />
          New Interview
        </Button>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          {
            label: "Projects",
            value: data?.projectCount ?? "—",
            icon: FolderOpen,
            href: "/projects",
          },
          {
            label: "Documents",
            value: data?.documentCount ?? "—",
            icon: FileText,
            href: "/knowledge",
          },
          {
            label: "Processed",
            value: data?.processedCount ?? "—",
            icon: CheckCircle2,
            href: "/knowledge",
          },
        ].map(({ label, value, icon: Icon, href }) => (
          <button
            key={label}
            onClick={() => navigate(href)}
            className="rounded-xl border border-border bg-card/60 p-5 text-left transition-colors hover:bg-card"
          >
            <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="size-4 text-primary" />
            </div>
            <div className="text-2xl font-bold">{loading ? "…" : value}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{label}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-6">
        {/* Recent Projects */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">Recent Projects</h2>
            <button
              onClick={() => navigate("/projects")}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View all <ChevronRight className="size-3" />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {loading ? (
              <div className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
                Loading…
              </div>
            ) : data?.recentProjects.length === 0 ? (
              <div className="rounded-xl border border-border bg-card/40 p-6 text-center">
                <p className="text-sm text-muted-foreground">No projects yet.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate("/projects")}
                >
                  Create project
                </Button>
              </div>
            ) : (
              data?.recentProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="flex items-center justify-between rounded-xl border border-border bg-card/60 p-4 text-left transition-colors hover:bg-card"
                >
                  <div>
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {p.documentCount} doc{p.documentCount !== 1 ? "s" : ""} ·{" "}
                      {p.technologies.length} tech
                      {p.technologies.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </section>

        {/* Recent General Knowledge */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">General Knowledge</h2>
            <button
              onClick={() => navigate("/knowledge")}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View all <ChevronRight className="size-3" />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {loading ? (
              <div className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
                Loading…
              </div>
            ) : data?.recentGeneralDocs.length === 0 ? (
              <div className="rounded-xl border border-border bg-card/40 p-6 text-center">
                <p className="text-sm text-muted-foreground">No general documents yet.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate("/knowledge")}
                >
                  Upload document
                </Button>
              </div>
            ) : (
              data?.recentGeneralDocs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-4"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.knowledgeSourceType.replace(/_/g, " ")} ·{" "}
                      {formatBytes(d.fileSize)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
