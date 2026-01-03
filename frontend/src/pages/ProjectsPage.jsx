import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { requestApi } from "../api/client.js";
import { useProject } from "../ProjectContext.jsx";

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

const imageStatusLabels = {
  pending: "В очереди",
  generating: "Генерируется",
  regenerating: "Регенерируется",
  ready: "Готово",
  approved: "Апрув",
  error: "Ошибка",
};

function getImageStatusLabel(status) {
  return imageStatusLabels[status] || status || "Нет статуса";
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
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProjectData(data) {
  if (!data || typeof data !== "object") {
    return createDefaultProjectData();
  }

  const normalizePages = Array.isArray(data.pages)
    ? data.pages.map((page, index) => ({
        id: page.id || `page-${index + 1}`,
        title: page.title || "",
        body: page.body || "",
        image: page.image || "",
      }))
    : createDefaultProjectData().pages;

  return {
    templates: Array.isArray(data.templates) ? data.templates : [],
    assets: Array.isArray(data.assets) ? data.assets : [],
    pages: normalizePages.length ? normalizePages : createDefaultProjectData().pages,
    generated: data.generated || null,
    archive: Array.isArray(data.archive) ? data.archive : [],
    status: data.status || "idle",
    statusNote: data.statusNote || "",
    pdfVersion: data.pdfVersion || null,
    updatedAt: data.updatedAt || new Date().toISOString(),
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
  const [projectDetails, setProjectDetails] = useState({});
  const [detailStatus, setDetailStatus] = useState({ state: "idle", message: "" });
  const [pollingError, setPollingError] = useState("");
  const syncSupported = useCallback((projectId) => /^(\d+)$/.test(String(projectId)), []);
  const { selectedProject, setSelectedProject } = useProject();
  const [activeTab, setActiveTab] = useState("content");
  const [detailOpen, setDetailOpen] = useState(false);
  const [templateCatalog, setTemplateCatalog] = useState([]);
  const [assetCatalog, setAssetCatalog] = useState([]);
  const [inputs, setInputs] = useState({
    templateIds: [],
    assetId: "",
  });
  const [pageLimitMessage, setPageLimitMessage] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState({ state: "idle", message: "" });

  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [projects],
  );

  const selectedProjectId = selectedProject?.id || null;

  const selectedProjectFromList = useMemo(
    () => sortedProjects.find((project) => project.id === selectedProjectId) || null,
    [sortedProjects, selectedProjectId],
  );

  const selectedProjectData = selectedProjectFromList
    ? normalizeProjectData(projectDetails[selectedProjectFromList.id] || createDefaultProjectData())
    : null;

  const currentProject = selectedProjectFromList;

  const detailStatusClass = (() => {
    if (detailStatus.state === "error") return "error";
    if (detailStatus.state === "saving" || detailStatus.state === "loading") return "pending";
    if (detailStatus.state === "synced") return "success";
    return "idle";
  })();

  const detailStatusText = detailStatus.message
    || (detailStatus.state === "idle"
      ? "Изменения не выполнялись"
      : "Состояние неизвестно");

  useEffect(() => {
    loadProjects();
    loadCatalogs();
  }, []);

  useEffect(() => {
    if (!sortedProjects.length) return;

    const selectedExists =
      currentProject && sortedProjects.some((project) => project.id === currentProject.id);

    const projectToSelect = selectedExists ? currentProject : sortedProjects[0] || null;

    if (!selectedExists && projectToSelect) {
      setSelectedProject(projectToSelect);
    }
  }, [currentProject, setSelectedProject, sortedProjects]);

  useEffect(() => {
    if (!currentProject?.id) return;
    if (!syncSupported(currentProject.id)) {
      setDetailStatus({ state: "error", message: "Синхронизация доступна только для серверных проектов" });
      return;
    }
    setPollingError("");
    setDetailStatus({ state: "loading", message: "Загружаем данные проекта..." });
    fetchProjectDetails(currentProject.id);
  }, [currentProject?.id, syncSupported]);

  useEffect(() => {
    if (!currentProject?.id || !syncSupported(currentProject.id)) return undefined;

    const interval = setInterval(() => {
      fetchProjectDetails(currentProject.id, { silent: true });
    }, 15000);

    return () => clearInterval(interval);
  }, [currentProject?.id, syncSupported]);

  const loadHistory = useCallback(async () => {
    setHistoryStatus({ state: "loading", message: "" });
    try {
      const { payload } = await requestApi("/history");
      const items = payload?.images || [];
      setHistory(items);
      setHistoryStatus({
        state: "success",
        message: items.length ? `Всего изображений: ${items.length}` : "Изображений пока нет",
      });
    } catch (apiError) {
      setHistory([]);
      setHistoryStatus({
        state: "error",
        message: apiError.message || "Не удалось загрузить историю",
      });
    }
  }, []);

  useEffect(() => {
    if (!detailOpen || activeTab !== "history") return;
    loadHistory();
  }, [activeTab, detailOpen, loadHistory]);

  const loadProjects = async () => {
    setLoading(true);
    setError("");

    try {
      const { payload } = await requestApi("/projects");
      const projectList = payload?.projects || payload || [];
      setProjects(projectList.map(normalizeProject));
    } catch (apiError) {
      setError(`Не удалось загрузить проекты: ${apiError.message || apiError}. Попробуйте позже.`);
    } finally {
      setLoading(false);
    }
  };

  const persistProjectDetails = async (projectId, data) => {
    if (!projectId) return;
    if (!syncSupported(projectId)) {
      const message = "Синхронизация доступна только для серверных проектов";
      setDetailStatus({ state: "error", message });
      setPollingError(message);
      return;
    }
    setDetailStatus({ state: "saving", message: "Сохраняем данные проекта..." });

    try {
      await requestApi(`/projects/${projectId}/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      setDetailStatus({ state: "synced", message: "Сохранено на сервере" });
      setPollingError("");
    } catch (saveError) {
      setDetailStatus({
        state: "error",
        message: saveError.message || "Не удалось сохранить данные проекта",
      });
      setPollingError(saveError.message || String(saveError));
    }
  };

  const fetchProjectDetails = async (projectId, { silent = false } = {}) => {
    if (!projectId) return;
    if (!syncSupported(projectId)) {
      const message = "Синхронизация доступна только для серверных проектов";
      setDetailStatus({
        state: "error",
        message,
      });
      setPollingError(message);
      return;
    }
    if (!silent) {
      setDetailStatus({ state: "loading", message: "Загружаем данные проекта..." });
    }

    try {
      const { payload } = await requestApi(`/projects/${projectId}/data`);
      const normalized = normalizeProjectData(payload?.data);
      setProjectDetails((prev) => ({ ...prev, [projectId]: normalized }));
      if (!silent) {
        setDetailStatus({ state: "synced", message: "Данные синхронизированы с сервером" });
      }
      setPollingError("");
    } catch (fetchError) {
      if (!silent || detailStatus.state !== "saving") {
        setDetailStatus({
          state: "error",
          message: fetchError.message || "Не удалось загрузить данные проекта",
        });
      }
      setPollingError(fetchError.message || String(fetchError));
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
      setSelectedProject(created);
      setDetailOpen(true);
      setActiveTab("content");
      setDialogOpen(false);
      setFormData({ name: "", description: "", tags: "" });
    } catch (apiError) {
      setError(`Не удалось сохранить проект: ${apiError.message || apiError}`);
      setDetailOpen(true);
    } finally {
      setCreating(false);
    }
  };

  const selectProject = (projectId) => {
    const foundProject = sortedProjects.find((project) => project.id === projectId);
    if (foundProject) {
      setSelectedProject(foundProject);
    }
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
    let nextState = null;
    setProjectDetails((prev) => {
      const current = normalizeProjectData(prev[projectId] || createDefaultProjectData());
      nextState = normalizeProjectData(updater(current));
      nextState.updatedAt = new Date().toISOString();
      return { ...prev, [projectId]: nextState };
    });

    if (projectId && nextState) {
      persistProjectDetails(projectId, nextState);
    }
  };

  const updateInput = (field, value) => {
    setInputs((prev) => ({ ...prev, [field]: value }));
  };

  const toggleTemplateSelection = (templateId) => {
    setInputs((prev) => {
      const idAsString = String(templateId);
      const alreadySelected = prev.templateIds.includes(idAsString);
      return {
        ...prev,
        templateIds: alreadySelected
          ? prev.templateIds.filter((id) => id !== idAsString)
          : [...prev.templateIds, idAsString],
      };
    });
  };

  const addTemplate = (event) => {
    event.preventDefault();

    if (!currentProject || !inputs.templateIds.length) return;

    const selectedTemplates = templateCatalog.filter((item) =>
      inputs.templateIds.includes(String(item.id)),
    );
    if (!selectedTemplates.length) return;

    updateProjectData(currentProject.id, (data) => {
      const existingIds = new Set(data.templates.map((item) => item.id));
      const prepared = selectedTemplates
        .filter((template) => !existingIds.has(template.id))
        .map((template) => ({
          id: template.id,
          name: template.name,
          text: template.text,
          kind: template.kind,
          description: template.description,
          assetUrl: template.assetUrl,
        }));

      return {
        ...data,
        templates: [...prepared, ...data.templates],
      };
    });

    setInputs((prev) => ({ ...prev, templateIds: [] }));
  };

  const addAsset = (event) => {
    event.preventDefault();
    if (!currentProject || !inputs.assetId) return;

    const asset = assetCatalog.find((item) => String(item.id) === inputs.assetId);
    if (!asset) return;

    updateProjectData(currentProject.id, (data) => ({
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
    if (!currentProject) return;
    updateProjectData(currentProject.id, (data) => ({
      ...data,
      templates: data.templates.filter((template) => template.id !== templateId),
    }));
  };

  const removeAsset = (assetId) => {
    if (!currentProject) return;
    updateProjectData(currentProject.id, (data) => ({
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
    updateProjectData(currentProject.id, (data) => ({
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
    if (!currentProject) return;

    updateProjectData(currentProject.id, (data) => ({
      ...data,
      pages: data.pages.map((page) => (page.id === pageId ? { ...page, [field]: value } : page)),
    }));
  };

  const removePage = (pageId) => {
    if (!currentProject) return;

    updateProjectData(currentProject.id, (data) => {
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
    if (!currentProject) return;
    updateProjectData(currentProject.id, () => createDefaultProjectData());
    setPageLimitMessage("");
  };

  const normalizeTemplate = (template) => ({
    id: template.id,
    name: template.name || template.title || "Без названия",
    text: template.description || template.content || "",
    kind: template.kind || "text",
    description: template.description || "",
    assetUrl: template.asset_url || template.assetUrl || template.content || "",
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

  const filteredTemplateCatalog = useMemo(() => {
    if (!templateFilter.trim()) return templateCatalog;
    const query = templateFilter.trim().toLowerCase();
    return templateCatalog.filter(
      (template) => {
        const name = String(template.name || "").toLowerCase();
        const text = String(template.text || "").toLowerCase();
        const kind = String(template.kind || "").toLowerCase();
        return name.includes(query) || text.includes(query) || kind.includes(query);
      },
    );
  }, [templateCatalog, templateFilter]);

  const generatePages = (isRegeneration = false) => {
    if (!currentProject || !selectedProjectData) return;
    if (!selectedProjectData.pages.length) return;

    updateProjectData(currentProject.id, (data) => {
      const archived = data.generated ? [data.generated, ...data.archive] : data.archive;
      const generation = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pages: data.pages.map((page, index) => ({
          ...page,
          index: index + 1,
          version: 1,
          regeneratedAt: new Date().toISOString(),
        })),
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

  const bumpImageVersion = (src) => {
    if (!src) return src;
    const [base] = src.split("?v=");
    return `${base}?v=${Date.now()}`;
  };

  const regeneratePage = (pageId) => {
    if (!currentProject || !selectedProjectData?.generated) return;

    updateProjectData(currentProject.id, (data) => {
      if (!data.generated) return data;

      const sourcePage = data.pages.find((page) => page.id === pageId);
      const archived = data.generated ? [JSON.parse(JSON.stringify(data.generated)), ...data.archive] : data.archive;
      const timestamp = new Date().toISOString();

      const updatedPages = data.generated.pages.map((page, index) => {
        if (page.id !== pageId) return { ...page, index: index + 1 };

        const merged = { ...page, ...sourcePage };
        const version = (page.version || 1) + 1;

        return {
          ...merged,
          index: index + 1,
          version,
          regeneratedAt: timestamp,
          image: bumpImageVersion(merged.image || page.image),
        };
      });

      return {
        ...data,
        generated: {
          ...data.generated,
          pages: updatedPages,
          updatedAt: timestamp,
          note: "Перегенерирован один лист",
          status: "ready",
        },
        archive: archived,
        status: "ready",
        statusNote: `Лист перегенерирован (${sourcePage?.title || "без названия"})`,
      };
    });
  };

  const openPreview = (src, title, index) => {
    if (!src) return;
    setPreview({ src, title, index });
  };

  const closePreview = () => setPreview(null);

  const assemblePdf = () => {
    if (!currentProject || !selectedProjectData?.generated) return;

    updateProjectData(currentProject.id, (data) => ({
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
                className={`card project-card ${currentProject?.id === project.id ? "active" : ""}`}
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
                {currentProject?.id === project.id && <span className="badge badge-success">Активен</span>}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Пока нет проектов. Создайте первый, чтобы начать.</p>
        )}
      </section>


      {detailOpen && currentProject && selectedProjectData && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="card modal project-window"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="section-head project-window__bar">
              <div>
                <p className="eyebrow">{currentProject.name}</p>
                <h2>Контент и генерация внутри проекта</h2>
                <p className="muted">
                  Каждый проект хранит свои шаблоны, ассеты и страницы. Генерация привязана к текущему
                  проекту и результаты можно перегенерировать, сохранив старые версии в отдельном
                  стеке.
                </p>
              </div>
              <div className="actions">
                <div className={`status-chip ${detailStatusClass}`} role="status">
                  {detailStatusText}
                </div>
                <button className="ghost" type="button" onClick={closeProjectWindow} aria-label="Закрыть">
                  Закрыть
                </button>
              </div>
            </header>

            {pollingError && (
              <p className="muted" style={{ color: "var(--red-500)", margin: "0 1rem" }}>
                Ошибка синхронизации: {pollingError}. Проверьте сеть или повторите попытку.
              </p>
            )}

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
                      <h3>Подключить шаблоны с сервера</h3>
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
                      Поиск по названию или описанию
                      <input
                        type="search"
                        placeholder="Например: герой, фон, макет"
                        value={templateFilter}
                        onChange={(event) => setTemplateFilter(event.target.value)}
                      />
                    </label>
                    <p className="muted">
                      Отметьте несколько шаблонов сразу, чтобы добавить их в проект. Превью карточек помогает
                      отличать текстовые заготовки и изображения персонажей.
                    </p>
                    <div className="template-cards">
                      {filteredTemplateCatalog.map((template) => {
                        const isSelected = inputs.templateIds.includes(String(template.id));
                        const hasImage = template.assetUrl && template.kind !== "text";
                        return (
                          <label
                            key={template.id}
                            className={`template-card ${isSelected ? "selected" : ""}`}
                          >
                            <div className="template-card__header">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleTemplateSelection(template.id)}
                              />
                              <div>
                                <div className="template-card__name">{template.name}</div>
                                <p className="muted">ID: {template.id} · Тип: {template.kind}</p>
                              </div>
                            </div>
                            {hasImage ? (
                              <img src={template.assetUrl} alt={template.name} className="template-card__preview" />
                            ) : template.text ? (
                              <p className="template-card__text">{template.text}</p>
                            ) : (
                              <p className="muted">Нет содержимого</p>
                            )}
                            {template.description && (
                              <p className="muted" style={{ marginTop: "0.5rem" }}>
                                {template.description}
                              </p>
                            )}
                          </label>
                        );
                      })}
                      {!filteredTemplateCatalog.length && (
                        <p className="muted">Каталог пуст или ни один шаблон не совпал с поиском.</p>
                      )}
                    </div>
                    <div className="actions">
                      <button type="button" className="ghost" onClick={loadCatalogs}>
                        Обновить каталоги
                      </button>
                      <button type="submit" className="primary" disabled={!inputs.templateIds.length}>
                        Добавить выбранные ({inputs.templateIds.length})
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
                  <Link
                    className="primary"
                    to={`/project/${currentProject.id}/generate`}
                    state={{ project: currentProject, projectData: selectedProjectData }}
                  >
                    Открыть генерацию
                  </Link>
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
                  <>
                    <div className="sheet-grid">
                      {selectedProjectData.generated.pages.map((page) => (
                        <article key={page.id} className="card sheet-card">
                          <div className="sheet-card__head">
                            <div>
                              <p className="eyebrow">Лист {page.index}</p>
                              <h4>{page.title || `Страница ${page.index}`}</h4>
                              <p className="muted sheet-card__meta">
                                {page.regeneratedAt
                                  ? `Обновлено ${formatDate(page.regeneratedAt)}`
                                  : "Нет данных об обновлении"}
                              </p>
                            </div>
                            <div className="sheet-card__tags">
                              <span className="badge badge-success">Версия {page.version || 1}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="sheet-card__preview"
                            disabled={!page.image}
                            onClick={() => openPreview(page.image, page.title || `Страница ${page.index}`, page.index)}
                          >
                            {page.image ? (
                              <img src={page.image} alt={page.title || "Превью листа"} />
                            ) : (
                              <div className="sheet-card__placeholder">Изображение появится после генерации</div>
                            )}
                            <span className="sheet-card__preview-hint">Нажмите, чтобы увеличить</span>
                          </button>

                          <p className="muted">{page.body || "Нет описания"}</p>

                          <div className="sheet-card__actions">
                            <button
                              className="ghost"
                              type="button"
                              disabled={!page.image}
                              onClick={() => openPreview(page.image, page.title || `Страница ${page.index}`, page.index)}
                            >
                              Открыть предпросмотр
                            </button>
                            <button className="primary" type="button" onClick={() => regeneratePage(page.id)}>
                              Перегенерировать лист
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>

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
                              <td>
                                {page.title || `Страница ${page.index}`}
                                <p className="muted">Версия {page.version || 1}</p>
                              </td>
                              <td className="muted">{page.body || "Нет описания"}</td>
                              <td>
                                {page.image ? (
                                  <a
                                    className="link"
                                    href={page.image}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(event) => event.stopPropagation()}
                                  >
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
                  </>
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
                    <h3>Все изображения, которые вы генерировали</h3>
                  </div>
                  <div className={`status-chip ${historyStatus.state}`} role="status">
                    {historyStatus.state === "loading" && "Загружаем историю..."}
                    {historyStatus.state === "success" && historyStatus.message}
                    {historyStatus.state === "error" && historyStatus.message}
                    {historyStatus.state === "idle" && "История не загружалась"}
                  </div>
                </div>

                {historyStatus.state === "loading" && <p className="muted">Подождите, собираем список...</p>}

                {historyStatus.state === "error" && (
                  <p className="status error">{historyStatus.message}</p>
                )}

                {history.length ? (
                  <div className="history-grid">
                    {history.map((item) => (
                      <article
                        key={`${item.generationId}-${item.sheetIndex}-${item.filename}`}
                        className="history-card"
                      >
                        {item.assetUrl ? (
                          <img
                            src={item.assetUrl}
                            alt={`Генерация ${item.generationId}, лист ${item.sheetIndex + 1}`}
                            className="history-thumb"
                          />
                        ) : (
                          <div className="history-thumb history-thumb__placeholder">Нет превью</div>
                        )}
                        <div className="history-meta">
                          <p className="template-name">
                            Генерация #{item.generationId} — Лист {item.sheetIndex + 1}
                          </p>
                          <p className="muted">
                            {item.createdAt ? `Создано ${formatDate(item.createdAt)}` : "Дата неизвестна"}
                          </p>
                          <div className="history-tags">
                            <span className={`badge badge-${item.status}`}>{getImageStatusLabel(item.status)}</span>
                            {item.approved && <span className="badge badge-success">Одобрено</span>}
                          </div>
                          {item.assetUrl && (
                            <a className="link" href={item.assetUrl} target="_blank" rel="noreferrer">
                              Открыть изображение
                            </a>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  historyStatus.state !== "loading" && (
                    <p className="muted">Пока нет сгенерированных изображений. Запустите генерацию, чтобы увидеть историю.</p>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop" role="presentation" onClick={closePreview}>
          <div
            className="card modal preview-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="section-head">
              <div>
                <p className="eyebrow">Лист {preview.index}</p>
                <h3>{preview.title || "Предпросмотр"}</h3>
              </div>
              <button className="ghost" type="button" onClick={closePreview} aria-label="Закрыть предпросмотр">
                ✕
              </button>
            </header>
            <div className="preview-modal__body">
              <img src={preview.src} alt={preview.title || "Изображение листа"} />
            </div>
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
