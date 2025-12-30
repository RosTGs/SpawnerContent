import { useEffect, useMemo, useState } from "react";

const apiBases = (() => {
  const candidates = ["/api"];
  const baseFromVite = import.meta.env.BASE_URL;

  if (baseFromVite && baseFromVite !== "/" && baseFromVite !== "./") {
    candidates.push(`${baseFromVite.replace(/\/$/, "")}/api`);
  }

  return Array.from(new Set(candidates));
})();

const mockProjects = [
  {
    id: "alpha",
    name: "Каталог ассетов",
    description: "Основная библиотека UI-элементов и иконок для мобильного приложения.",
    tags: ["UI", "Mobile"],
    updatedAt: "2024-05-12T08:30:00Z",
  },
  {
    id: "beta",
    name: "Маркетинговые материалы",
    description: "Баннеры и рекламные креативы для предстоящего релиза.",
    tags: ["Promo", "Design"],
    updatedAt: "2024-06-02T13:00:00Z",
  },
  {
    id: "gamma",
    name: "3D-сцены",
    description: "Набор ассетов и настроек освещения для демонстрационных сцен.",
    tags: ["3D", "Lighting"],
    updatedAt: "2024-05-25T17:10:00Z",
  },
];

async function requestApi(path, options = {}) {
  let lastError = null;

  for (const base of apiBases) {
    const url = `${base}${path}`;

    try {
      const response = await fetch(url, options);
      const isJson = response.headers
        .get("content-type")
        ?.includes("application/json");

      const payload = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const message =
          typeof payload === "string"
            ? payload || `HTTP ${response.status}`
            : payload?.error || `HTTP ${response.status}`;
        throw new Error(message);
      }

      return { response, payload };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось выполнить запрос к API");
}

function normalizeProject(project) {
  const normalizedTags = Array.isArray(project?.tags)
    ? project.tags
    : typeof project?.tags === "string"
      ? project.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [];

  return {
    id: project.id || project.slug || crypto.randomUUID(),
    name: project.name || "Новый проект",
    description: project.description || "",
    tags: normalizedTags,
    updatedAt: project.updatedAt || project.updated_at || new Date().toISOString(),
  };
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
}

function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({ name: "", description: "", tags: "" });

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [projects],
  );

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    setError("");

    try {
      const { payload } = await requestApi("/projects");
      const projectList = payload?.projects || payload || [];
      setProjects(projectList.map(normalizeProject));
    } catch (apiError) {
      setError(`Не удалось загрузить проекты: ${apiError.message || apiError}. Используется мок.`);
      setProjects(mockProjects.map(normalizeProject));
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const submitProject = async (event) => {
    event.preventDefault();
    setCreating(true);
    setError("");

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim(),
      tags: formData.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    try {
      const { payload: responsePayload } = await requestApi("/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const created = normalizeProject(responsePayload?.project || responsePayload || payload);
      setProjects((prev) => [created, ...prev]);
      setDialogOpen(false);
      setFormData({ name: "", description: "", tags: "" });
    } catch (apiError) {
      const mockProject = normalizeProject({ ...payload, id: `mock-${Date.now()}` });
      setProjects((prev) => [mockProject, ...prev]);
      setError(`Не удалось сохранить проект: ${apiError.message || apiError}. Добавлен мок.`);
      setDialogOpen(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <section className="card">
        <header className="section-head">
          <div>
            <p className="eyebrow">Проекты</p>
            <h1>Проекты и спринты</h1>
            <p className="muted">
              Управляйте сценариями генерации ассетов, группируйте шаблоны и отслеживайте прогресс по спринтам.
            </p>
          </div>
          <button className="primary" onClick={() => setDialogOpen(true)}>
            + Создать проект
          </button>
        </header>

        {error && <p className="status">{error}</p>}

        {loading ? (
          <p className="muted">Загружаем список проектов...</p>
        ) : sortedProjects.length ? (
          <div className="grid projects-grid">
            {sortedProjects.map((project) => (
              <article key={project.id} className="card project-card">
                <header className="project-head">
                  <div>
                    <p className="eyebrow">ID: {project.id}</p>
                    <h3>{project.name}</h3>
                  </div>
                  <span className="muted">Обновлён {formatDate(project.updatedAt)}</span>
                </header>
                <p className="muted">{project.description || "Описание не заполнено"}</p>
                {project.tags?.length ? (
                  <div className="tag-row">
                    {project.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Теги не заданы</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Пока нет проектов. Создайте первый, чтобы начать.</p>
        )}
      </section>

      {dialogOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setDialogOpen(false)}>
          <div className="card modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="section-head">
              <div>
                <p className="eyebrow">Новый проект</p>
                <h2>Создание проекта</h2>
              </div>
              <button className="ghost" onClick={() => setDialogOpen(false)} aria-label="Закрыть">
                ✕
              </button>
            </header>

            <form className="form" onSubmit={submitProject}>
              <label>
                Название
                <input
                  name="name"
                  required
                  placeholder="Например, Каталог ассетов"
                  value={formData.name}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </label>

              <label>
                Описание
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Коротко опишите цель проекта"
                  value={formData.description}
                  onChange={(event) => updateField("description", event.target.value)}
                />
              </label>

              <label>
                Теги
                <input
                  name="tags"
                  placeholder="Например: UI, Mobile, Promo"
                  value={formData.tags}
                  onChange={(event) => updateField("tags", event.target.value)}
                />
              </label>

              <div className="actions">
                <button type="button" className="ghost" onClick={() => setDialogOpen(false)}>
                  Отмена
                </button>
                <button type="submit" className="primary" disabled={creating || !formData.name.trim()}>
                  {creating ? "Создаём..." : "Создать"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default ProjectsPage;
