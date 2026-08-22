import { NavLink, useNavigate } from "react-router";
import { Mic, LayoutDashboard, FolderOpen, BookOpen } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export function NavBar() {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <div
          className="flex items-center gap-2 cursor-pointer select-none"
          onClick={() => navigate("/")}
        >
          <div className="flex size-7 items-center justify-center rounded-md bg-primary">
            <Mic className="size-4 text-primary-foreground" />
          </div>
          <span className="font-semibold tracking-tight">InterviewForge</span>
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )
            }
          >
            <LayoutDashboard className="size-3.5" />
            Dashboard
          </NavLink>
          <NavLink
            to="/projects"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )
            }
          >
            <FolderOpen className="size-3.5" />
            Projects
          </NavLink>
          <NavLink
            to="/knowledge"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )
            }
          >
            <BookOpen className="size-3.5" />
            Knowledge
          </NavLink>
        </nav>

        {/* CTA */}
        <Button size="sm" onClick={() => navigate("/interview/new")} className="gap-1.5">
          <Mic className="size-3.5" />
          New Interview
        </Button>
      </div>
    </header>
  );
}
