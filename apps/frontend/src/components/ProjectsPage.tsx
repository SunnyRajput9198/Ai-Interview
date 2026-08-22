import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import axios from "axios";
import { BACKEND_URL } from "@/lib/config";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { FolderOpen, Plus, Trash2, ChevronRight, Loader2 } from "lucide-react";

interface Project {
  id: string;
  name: string;
  description: string | null;
  technologies: string[];
  documentCount: number;
  createdAt: string;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [techInput, setTechInput] = useState("");
  const [techs, setTechs] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    fetchProjects();
  }, []);

  async function fetchProjects() {
    setLoading(true);
    try {
      const r = await axios.get(`${BACKEND_URL}/api/projects`);
      setProjects(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) { setNameError("Project name is required"); return; }
    setCreating(true);
    try {
      const r = await axios.post(`${BACKEND_URL}/api/projects`, {
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        technologies: techs,
      });
      setProjects((prev) => [{ ...r.data, documentCount: 0 }, ...prev]);
      cancelCreate();
    } catch (e: any) {
      setNameError(e?.response?.data?.error ?? "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  function cancelCreate() {
    setShowCreate(false);
    setNewName("");
    setNewDesc("");
    setTechs([]);
    setTechInput("");
    setNameError("");
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete project "${name}" and all its documents? This cannot be undone.`)) return;
    try {
      await axios.delete(`${BACKEND_URL}/api/projects/${id}`);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error(e);
    }
  }

  function addTech(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const t = techInput.trim().replace(/,$/, "");
      if (t && !techs.includes(t)) setTechs((prev) => [...prev, t]);
      setTechInput("");
    }
  }

  function removeTech(t: string) {
    setTechs((prev) => prev.filter((x) => x !== t));
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organise your uploaded documents into projects.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="size-4" />
          Create Project
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 rounded-xl border border-border bg-card/60 p-5">
          <h2 className="mb-4 text-sm font-semibold">New Project</h2>
          <div className="flex flex-col gap-3">
            <div>
              <Label className="mb-1 block text-xs">Name *</Label>
              <Input
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setNameError(""); }}
                placeholder="e.g. MetaSpace"
                autoFocus
              />
              {nameError && <p className="mt-1 text-xs text-destructive">{nameError}</p>}
            </div>
            <div>
              <Label className="mb-1 block text-xs">Description</Label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Short description of the project"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">
                Technologies{" "}
                <span className="text-muted-foreground">(press Enter or comma to add)</span>
              </Label>
              <Input
                value={techInput}
                onChange={(e) => setTechInput(e.target.value)}
                onKeyDown={addTech}
                placeholder="TypeScript, React, PostgreSQL…"
              />
              {techs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {techs.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {t}
                      <button onClick={() => removeTech(t)}>
                        <span className="sr-only">Remove</span>×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={cancelCreate}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating && <Loader2 className="size-3.5 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Project list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <FolderOpen className="mx-auto mb-3 size-8 text-muted-foreground/50" />
          <p className="font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a project to organise your documents.
          </p>
          <Button className="mt-4" onClick={() => setShowCreate(true)}>
            Create your first project
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex flex-col rounded-xl border border-border bg-card/60 p-5 transition-colors hover:bg-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{p.name}</h3>
                  {p.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(p.id, p.name)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{p.documentCount} doc{p.documentCount !== 1 ? "s" : ""}</span>
                {p.technologies.length > 0 && (
                  <>
                    <span>·</span>
                    <span className="truncate">
                      {p.technologies.slice(0, 3).join(", ")}
                      {p.technologies.length > 3 && ` +${p.technologies.length - 3}`}
                    </span>
                  </>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full gap-1.5"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                Open Project
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
