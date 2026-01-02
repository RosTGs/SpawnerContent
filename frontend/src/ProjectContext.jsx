import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "projects:selected";

const ProjectContext = createContext(null);

function readStoredProject() {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.id ? parsed : null;
  } catch (error) {
    return null;
  }
}

export function ProjectProvider({ children }) {
  const [selectedProject, setSelectedProject] = useState(() => readStoredProject());

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      if (selectedProject) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedProject));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      /* noop */
    }
  }, [selectedProject]);

  const contextValue = useMemo(
    () => ({
      selectedProject,
      setSelectedProject,
    }),
    [selectedProject],
  );

  return <ProjectContext.Provider value={contextValue}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const context = useContext(ProjectContext);

  if (!context) {
    throw new Error("useProject должен использоваться внутри ProjectProvider");
  }

  return context;
}
