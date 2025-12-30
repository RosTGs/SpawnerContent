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
      const isJson = response.headers.get("content-type")?.includes("application/json");

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

function createDefaultProjectData() {
  return {
    templates: [],
    assets: [],
    pages: [
      {
        id: crypto.randomUUID(),
        title: "Страница 1",
        body: "",
        image: "",
      },
    ],
    generated: null,
    archive: [],
    status: "idle",
    statusNote: "",
    pdfVersion: null,
  };
}

function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogStatus, setCatalogStatus] = useState({ state: "idle", message: "" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({ name: "", description: "", tags: "" });
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [projectDetails, setProjectDetails] = useState({});
  const [activeTab, setActiveTab] = useState("content");
  const [detailOpen, setDetailOpen] = useState(false);
  const [templateCatalog, setTemplateCatalog] = useState([]);
  const [assetCatalog, setAssetCatalog] = useState([]);
  const [inputs, setInputs] = useState({
    templateId: "",
    assetId: "",
  });
  const [pageLimitMessage, setPageLimitMessage] = useState("");

  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [projects],
  );

  const selectedProject = useMemo(
    () => sortedProjects.find((project) => project.id === selectedProjectId) || null,
    [sortedProjects, selectedProjectId],
  );

  const selectedProjectData = selectedProject
    ? projectDetails[selectedProject.id] || createDefaultProjectData()
    : null;

  useEffect(() => {
    loadProjects();
    loadCatalogs();
  }, []);

  useEffect(() => {
    if (!selectedProjectId && sortedProjects.length) {
      const firstProject = sortedProjects[0];
      setSelectedProjectId(firstProject.id);
      setProjectDetails((prev) => ({
        ...prev,
        [firstProject.id]: prev[firstProject.id] || createDefaultProjectData(),
      }));
    }
  }, [sortedProjects, selectedProjectId]);

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
      setProjectDetails((prev) => ({ ...prev, [created.id]: createDefaultProjectData() }));
      setSelectedProjectId(created.id);
      setDetailOpen(true);
      setActiveTab("content");
      setDialogOpen(false);
      setFormData({ name: "", description: "", tags: "" });
    } catch (apiError) {
      const mockProject = normalizeProject({ ...payload, id: `mock-${Date.now()}` });
      setProjects((prev) => [mockProject, ...prev]);
      setProjectDetails((prev) => ({ ...prev, [mockProject.id]: createDefaultProjectData() }));
      setSelectedProjectId(mockProject.id);
      setDetailOpen(true);
      setActiveTab("content");
      setError(`Не удалось сохранить проект: ${apiError.message || apiError}. Добавлен мок.`);
      setDialogOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const selectProject = (projectId) => {
    setSelectedProjectId(projectId);
    setActiveTab("content");
    setProjectDetails((prev) => ({
      ...prev,
      [projectId]: prev[projectId] || createDefaultProjectData(),
    }));
  };

  const openProjectWindow = (projectId) => {
    selectProject(projectId);
    setDetailOpen(true);
  };

  const closeProjectWindow = () => {
    setDetailOpen(false);
  };

  const updateProjectData = (projectId, updater) => {
    setProjectDetails((prev) => {
      const current = prev[projectId] || createDefaultProjectData();
      return { ...prev, [projectId]: updater(current) };
    });
  };

  const updateInput = (field, value) => {
    setInputs((prev) => ({ ...prev, [field]: value }));
  };

  const addTemplate = (event) => {
    event.preventDefault();

    if (!selectedProject || !inputs.templateId) return;

    const template = templateCatalog.find((item) => String(item.id) === inputs.templateId);
    if (!template) return;

    updateProjectData(selectedProject.id, (data) => ({
      ...data,
      templates: data.templates.some((item) => item.id === template.id)
        ? data.templates
        : [
            {
              id: template.id,
              name: template.name,
              text: template.text,
              kind: template.kind,
            },
            ...data.templates,
          ],
    }));

    setInputs((prev) => ({ ...prev, templateId: "" }));
  };

  const addAsset = (event) => {
    event.preventDefault();
    if (!selectedProject || !inputs.assetId) return;

    const asset = assetCatalog.find((item) => String(item.id) === inputs.assetId);
    if (!asset) return;

    updateProjectData(selectedProject.id, (data) => ({
      ...data,
      assets: data.assets.some((item) => item.id === asset.id)
        ? data.assets
        : [
            {
              id: asset.id,
              name: asset.name,
              role: asset.role,
              kind: asset.kind,
            },
            ...data.assets,
          ],
    }));

    setInputs((prev) => ({ ...prev, assetId: "" }));
  };

  const removeTemplate = (templateId) => {
    if (!selectedProject) return;
    updateProjectData(selectedProject.id, (data) => ({
      ...data,
      templates: data.templates.filter((template) => template.id !== templateId),
    }));
  };

  const removeAsset = (assetId) => {
    if (!selectedProject) return;
    updateProjectData(selectedProject.id, (data) => ({
      ...data,
      assets: data.assets.filter((asset) => asset.id !== assetId),
    }));
  };

  const addPage = () => {
    if (!selectedProjectData) return;

    if (selectedProjectData.pages.length >= 101) {
      setPageLimitMessage("Можно добавить максимум 101 страницу");
      return;
    }

    setPageLimitMessage("");
    updateProjectData(selectedProject.id, (data) => ({
      ...data,
      pages: [
        ...data.pages,
        {
          id: crypto.randomUUID(),
          title: `Страница ${data.pages.length + 1}`,
          body: "",
          image: "",
        },
      ],
    }));
  };

  const updatePageField = (pageId, field, value) => {
    if (!selectedProject) return;

    updateProjectData(selectedProject.id, (data) => ({
      ...data,
      pages: data.pages.map((page) => (page.id === pageId ? { ...page, [field]: value } : page)),
    }));
  };

  const removePage = (pageId) => {
    if (!selectedProject) return;

    updateProjectData(selectedProject.id, (data) => {
      const remaining = data.pages.filter((page) => page.id !== pageId);
      return {
        ...data,
        pages: remaining.length ? remaining : [
          {
            id: crypto.randomUUID(),
            title: "Страница 1",
            body: "",
            image: "",
          },
        ],
      };
    });
  };

  const resetContent = () => {
    if (!selectedProject) return;
    updateProjectData(selectedProject.id, () => createDefaultProjectData());
    setPageLimitMessage("");
  };

  const normalizeTemplate = (template) => ({
    id: template.id,
    name: template.name || template.title || "Без названия",
    text: template.description || template.content || "",
    kind: template.kind || "text",
  });

  const normalizeAsset = (asset) => ({
    id: asset.id,
    name: asset.filename || asset.name || "Ассет",
    role: asset.description || "",
    kind: asset.kind || "asset",
  });

  const loadCatalogs = async () => {
    setCatalogStatus({ state: "pending", message: "Загружаем каталоги шаблонов и ассетов..." });

    try {
      const [{ payload: templatePayload }, { payload: assetPayload }] = await Promise.all([
        requestApi("/templates"),
        requestApi("/assets"),
      ]);

      setTemplateCatalog((templatePayload?.templates || []).map(normalizeTemplate));
      setAssetCatalog((assetPayload?.assets || []).map(normalizeAsset));
      setCatalogStatus({ state: "success", message: "Каталоги загружены с сервера" });
    } catch (catalogError) {
      setCatalogStatus({
        state: "error",
        message: `Не удалось загрузить каталоги: ${catalogError.message || catalogError}`,
      });
    }
  };

  const generatePages = (isRegeneration = false) => {
    if (!selectedProject || !selectedProjectData) return;
    if (!selectedProjectData.pages.length) return;

    updateProjectData(selectedProject.id, (data) => {
      const archived = data.generated ? [data.generated, ...data.archive] : data.archive;
      const generation = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        pages: data.pages.map((page, index) => ({ ...page, index: index + 1 })),
        templates: data.templates,
        assets: data.assets,
        status: "ready",
        note: isRegeneration ? "Перегенерировано" : "Сгенерировано",
      };

      return {
        ...data,
        generated: generation,
        archive: archived,
        status: "ready",
        statusNote: generation.note,
      };
    });
  };

  const assemblePdf = () => {
    if (!selectedProject || !selectedProjectData?.generated) return;

    updateProjectData(selectedProject.id, (data) => ({
      ...data,
      pdfVersion: {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        pages: data.generated.pages.length,
      },
      status: "ready",
      statusNote: "PDF собран и сохранён",
    }));
  };

  return (
    <>
      <section className="card">
        <header className="section-head">
          <div>
            <p className="eyebrow">Проекты</p>
            <h1>Проекты и спринты</h1>
            <p className="muted">
              Управляйте сценариями генерации ассетов, группируйте шаблоны и отслеживайте прогресс
              по спринтам.
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
              <article
                key={project.id}
                className={`card project-card ${selectedProjectId === project.id ? "active" : ""}`}
                onClick={() => selectProject(project.id)}
              >
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
                <div className="card-actions">
                  <span className="eyebrow">Страницы: {projectDetails[project.id]?.pages?.length || 0}</span>
                  <button
                    className="ghost"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProjectWindow(project.id);
                    }}
                  >
                    Открыть
                  </button>
                </div>
                {selectedProjectId === project.id && <span className="badge badge-success">Активен</span>}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Пока нет проектов. Создайте первый, чтобы начать.</p>
        )}
      </section>


      {detailOpen && selectedProject && selectedProjectData && (
        <div className="modal-backdrop" role="presentation" onClick={closeProjectWindow}>
          <div
            className="card modal project-window"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="section-head project-window__bar">
              <div>
                <p className="eyebrow">{selectedProject.name}</p>
                <h2>Контент и генерация внутри проекта</h2>
                <p className="muted">
                  Каждый проект хранит свои шаблоны, ассеты и страницы. Генерация привязана к текущему
                  проекту и результаты можно перегенерировать, сохранив старые версии в отдельном
                  стеке.
                </p>
              </div>
              <div className="actions">
                <div className="status-chip success">Сохранено локально</div>
                <button className="ghost" type="button" onClick={closeProjectWindow} aria-label="Закрыть">
                  Закрыть
                </button>
              </div>
            </header>

            <div className="tab-row">
              <button
                className={`pill ${activeTab === "content" ? "pill-active" : ""}`}
                onClick={() => setActiveTab("content")}
              >
                Контент проекта
              </button>
              <button
                className={`pill ${activeTab === "generation" ? "pill-active" : ""}`}
                onClick={() => setActiveTab("generation")}
              >
                Генерация
              </button>
              <button
                className={`pill ${activeTab === "history" ? "pill-active" : ""}`}
                onClick={() => setActiveTab("history")}
              >
                История
              </button>
            </div>

            {activeTab === "content" && (
              <div className="content-grid">
                <div className="card muted-surface">
                  <div className="section-head">
                    <div>
                      <p className="eyebrow">Шаблоны</p>
                      <h3>Подключить шаблон с сервера</h3>
                    </div>
                    <div className={`status-chip ${catalogStatus.state}`} role="status">
                      {catalogStatus.state === "pending" && "Загружаем каталоги..."}
                      {catalogStatus.state === "success" && catalogStatus.message}
                      {catalogStatus.state === "error" && catalogStatus.message}
                      {catalogStatus.state === "idle" && "Каталоги не загружались"}
                    </div>
                  </div>
                  <form className="form" onSubmit={addTemplate}>
                    <label>
                      Шаблон из библиотеки
                      <select
                        value={inputs.templateId}
                        onChange={(event) => updateInput("templateId", event.target.value)}
                      >
                        <option value="">Выберите сохранённый шаблон</option>
                        {templateCatalog.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name} · {template.kind}
                          </option>
                        ))}
                      </select>
                      <p className="muted">Шаблоны берутся из сохранённого каталога на сервере.</p>
                    </label>
                    <div className="actions">
                      <button type="button" className="ghost" onClick={loadCatalogs}>
                        Обновить каталоги
                      </button>
                      <button type="submit" className="primary" disabled={!inputs.templateId}>
                        Добавить выбранный шаблон
                      </button>
                    </div>
                  </form>
                  {selectedProjectData.templates.length ? (
                    <table className="table templates-table">
                      <thead>
                        <tr>
                          <th>Название</th>
                          <th>Текст</th>
                          <th className="right">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProjectData.templates.map((template) => (
                          <tr key={template.id}>
                            <td className="template-title">
                              <span className="template-name">{template.name}</span>
                              <span className="eyebrow">ID: {template.id}</span>
                            </td>
                            <td className="template-content">{template.text || "—"}</td>
                            <td className="right">
                              <button className="ghost" onClick={() => removeTemplate(template.id)}>
                                Удалить
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted">Пока нет шаблонов. Добавьте первый, чтобы использовать его при генерации.</p>
                  )}
                </div>

                <div className="card muted-surface">
                  <div className="section-head">
                    <div>
                      <p className="eyebrow">Ассеты</p>
                      <h3>Персонажи и ассеты с сервера</h3>
                    </div>
                  </div>
                  <form className="form" onSubmit={addAsset}>
                    <label>
                      Ассет из библиотеки
                      <select value={inputs.assetId} onChange={(event) => updateInput("assetId", event.target.value)}>
                        <option value="">Выберите сохранённый ассет или персонажа</option>
                        {assetCatalog.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name} · {asset.kind}
                          </option>
                        ))}
                      </select>
                      <p className="muted">Используются ассеты, ранее загруженные на сервер.</p>
                    </label>
                    <div className="actions">
                      <button type="button" className="ghost" onClick={loadCatalogs}>
                        Обновить каталоги
                      </button>
                      <button type="submit" className="primary" disabled={!inputs.assetId}>
                        Добавить ассет
                      </button>
                    </div>
                  </form>
                  {selectedProjectData.assets.length ? (
                    <ul className="stack-list">
                      {selectedProjectData.assets.map((asset) => (
                        <li key={asset.id} className="stack-item">
                          <div>
                            <p className="template-name">{asset.name}</p>
                            {asset.role && <p className="muted">{asset.role}</p>}
                          </div>
                          <button className="ghost" onClick={() => removeAsset(asset.id)}>
                            Удалить
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">Добавьте персонажей или ассеты, чтобы использовать их на страницах.</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "content" && (
              <div className="card muted-surface">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Страницы</p>
                    <h3>До 101 страницы с индивидуальными настройками</h3>
                  </div>
                  <div className="actions">
                    <button className="ghost" onClick={resetContent}>Удалить контент</button>
                    <button className="primary" onClick={addPage}>+ Добавить страницу</button>
                  </div>
                </div>
                {pageLimitMessage && <p className="status warning">{pageLimitMessage}</p>}
                <div className="page-grid">
                  {selectedProjectData.pages.map((page, index) => (
                    <div key={page.id} className="page-card">
                      <div className="page-head">
                        <span className="badge badge-pending">Страница {index + 1}</span>
                        <button className="ghost" onClick={() => removePage(page.id)} aria-label="Удалить страницу">
                          ✕
                        </button>
                      </div>
                      <label>
                        Заголовок
                        <input
                          value={page.title}
                          onChange={(event) => updatePageField(page.id, "title", event.target.value)}
                          placeholder="Название страницы"
                        />
                      </label>
                      <label>
                        Наполнение
                        <textarea
                          rows={3}
                          value={page.body}
                          onChange={(event) => updatePageField(page.id, "body", event.target.value)}
                          placeholder="Текст, сюжет, задания для этой страницы"
                        />
                      </label>
                      <label>
                        Ссылка на изображение (1 на страницу)
                        <input
                          value={page.image}
                          onChange={(event) => updatePageField(page.id, "image", event.target.value)}
                          placeholder="https://..."
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "generation" && (
              <div className="card muted-surface">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Генерация внутри проекта</p>
                    <h3>Генерируйте страницы с учётом шаблонов и ассетов</h3>
                    <p className="muted">
                      Все страницы генерируются сразу. При перегенерации предыдущий результат сохраняется
                      в отдельном стеке для отката.
                    </p>
                  </div>
                  <div className="status-chip">
                    {selectedProjectData.statusNote || "Статус не задан"}
                  </div>
                </div>

                <div className="summary-row">
                  <div className="summary-box">
                    <p className="eyebrow">Шаблоны</p>
                    <p className="summary-number">{selectedProjectData.templates.length}</p>
                    <p className="muted">Подключены к генерации</p>
                  </div>
                  <div className="summary-box">
                    <p className="eyebrow">Ассеты</p>
                    <p className="summary-number">{selectedProjectData.assets.length}</p>
                    <p className="muted">Персонажи и ресурсы</p>
                  </div>
                  <div className="summary-box">
                    <p className="eyebrow">Страницы</p>
                    <p className="summary-number">{selectedProjectData.pages.length}</p>
                    <p className="muted">Каждая с 1 изображением</p>
                  </div>
                </div>

                <div className="actions">
                  <button className="primary" onClick={() => generatePages(false)}>
                    Сгенерировать страницы
                  </button>
                  <button
                    className="ghost"
                    onClick={() => generatePages(true)}
                    disabled={!selectedProjectData.generated}
                  >
                    Перегенерировать
                  </button>
                  <button
                    className="ghost"
                    onClick={assemblePdf}
                    disabled={!selectedProjectData.generated}
                  >
                    Собрать PDF
                  </button>
                </div>

                {selectedProjectData.generated ? (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Страница</th>
                          <th>Текст</th>
                          <th>Изображение</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProjectData.generated.pages.map((page) => (
                          <tr key={page.id}>
                            <td>{page.title || `Страница ${page.index}`}</td>
                            <td className="muted">{page.body || "Нет описания"}</td>
                            <td>
                              {page.image ? (
                                <a className="link" href={page.image} target="_blank" rel="noreferrer">
                                  Открыть
                                </a>
                              ) : (
                                "Не прикреплено"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">
                    Заполните страницы, добавьте шаблоны и ассеты, затем запустите генерацию. Результат
                    появится здесь и его можно будет перегенерировать.
                  </p>
                )}
              </div>
            )}

            {activeTab === "history" && (
              <div className="card muted-surface">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">История</p>
                    <h3>Предыдущие версии и собранные PDF</h3>
                  </div>
                </div>

                {selectedProjectData.archive.length ? (
                  <ul className="stack-list">
                    {selectedProjectData.archive.map((entry) => (
                      <li key={entry.id} className="stack-item">
                        <div>
                          <p className="template-name">{entry.note || "Генерация"}</p>
                          <p className="muted">
                            {entry.pages.length} страниц · сохранено {formatDate(entry.createdAt)}
                          </p>
                        </div>
                        <span className="badge badge-pending">Архив</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Пока нет прошлых генераций. После перегенерации предыдущий вариант появится здесь.</p>
                )}

                {selectedProjectData.pdfVersion ? (
                  <div className="pdf-block">
                    <div>
                      <p className="eyebrow">PDF</p>
                      <p className="template-name">Сборка от {formatDate(selectedProjectData.pdfVersion.createdAt)}</p>
                      <p className="muted">Страниц: {selectedProjectData.pdfVersion.pages}</p>
                    </div>
                    <span className="badge badge-success">Готово</span>
                  </div>
                ) : (
                  <p className="muted">Нажмите «Собрать PDF» после удачной генерации, чтобы сохранить итоговый документ.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
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
