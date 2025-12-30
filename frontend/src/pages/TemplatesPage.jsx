import { useEffect, useMemo, useState } from "react";

const apiBases = (() => {
  const candidates = ["/api"];
  const baseFromVite = import.meta.env.BASE_URL;

  if (baseFromVite && baseFromVite !== "/" && baseFromVite !== "./") {
    candidates.push(`${baseFromVite.replace(/\/$/, "")}/api`);
  }

  return Array.from(new Set(candidates));
})();

const mockTemplates = [
  {
    id: "hero-banner",
    name: "Hero Banner",
    goal: "Шапка лендинга с CTA",
    tags: ["web", "promo"],
    description: "Главный экран для продуктового лендинга с иллюстрацией и кнопкой действия.",
  },
  {
    id: "product-card",
    name: "Карточка товара",
    goal: "Универсальный блок каталога",
    tags: ["ecommerce", "ui"],
    description: "Компонент с фото, ценой, рейтингом и быстрыми действиями.",
  },
  {
    id: "email-template",
    name: "Письмо-напоминание",
    goal: "Email о возвращении в продукт",
    tags: ["email", "retention"],
    description: "Письмо с персонализацией, блоком выгоды и кнопкой возврата в сервис.",
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

function normalizeTemplate(template) {
  const normalizedTags = Array.isArray(template?.tags)
    ? template.tags
    : typeof template?.tags === "string"
      ? template.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

  return {
    id: template.id || template.slug || crypto.randomUUID(),
    name: template.name || "Новый шаблон",
    goal: template.goal || template.purpose || "Цель не указана",
    description: template.description || "Описание не заполнено",
    tags: normalizedTags,
  };
}

function buildTemplateFromText(text) {
  const trimmed = text.trim();

  return normalizeTemplate({
    id: `draft-${Date.now()}`,
    name: trimmed.slice(0, 40) || "Концепт шаблона",
    goal: "Создано по текстовому описанию",
    description: trimmed || "Описания пока нет",
    tags: ["draft", "text"],
  });
}

function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [formData, setFormData] = useState({ name: "", goal: "", description: "", tags: "" });
  const [textPrompt, setTextPrompt] = useState("");

  const sortedTemplates = useMemo(
    () => [...templates].sort((left, right) => left.name.localeCompare(right.name)),
    [templates],
  );

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    setError("");
    setInfo("");

    try {
      const { payload } = await requestApi("/templates");
      const templateList = payload?.templates || payload || [];
      setTemplates(templateList.map(normalizeTemplate));
    } catch (apiError) {
      setError(`Не удалось загрузить шаблоны: ${apiError.message || apiError}. Используется мок.`);
      setTemplates(mockTemplates.map(normalizeTemplate));
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const submitTemplate = async (event) => {
    event.preventDefault();
    setCreating(true);
    setError("");
    setInfo("");

    const payload = {
      name: formData.name.trim(),
      goal: formData.goal.trim(),
      description: formData.description.trim(),
      tags: formData.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    try {
      const { payload: responsePayload } = await requestApi("/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const created = normalizeTemplate(responsePayload?.template || responsePayload || payload);
      setTemplates((prev) => [created, ...prev]);
      setDialogOpen(false);
      setFormData({ name: "", goal: "", description: "", tags: "" });
      setInfo("Шаблон сохранён");
    } catch (apiError) {
      const mockTemplate = normalizeTemplate({ ...payload, id: `mock-${Date.now()}` });
      setTemplates((prev) => [mockTemplate, ...prev]);
      setError(`Не удалось сохранить шаблон: ${apiError.message || apiError}. Добавлен мок.`);
      setDialogOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const generateFromText = async (event) => {
    event.preventDefault();
    if (!textPrompt.trim()) return;

    setGenerateLoading(true);
    setError("");
    setInfo("");

    try {
      const { payload } = await requestApi("/templates/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description: textPrompt.trim() }),
      });

      const generated = normalizeTemplate(payload?.template || payload);
      setTemplates((prev) => [generated, ...prev]);
      setTextPrompt("");
      setInfo("Шаблон создан по описанию");
    } catch (apiError) {
      const draft = buildTemplateFromText(textPrompt);
      setTemplates((prev) => [draft, ...prev]);
      setError(`Не удалось вызвать генерацию: ${apiError.message || apiError}. Добавлен черновик.`);
      setTextPrompt("");
    } finally {
      setGenerateLoading(false);
    }
  };

  const deleteTemplate = async (templateId) => {
    setError("");
    setInfo("");

    try {
      await requestApi(`/templates/${templateId}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((template) => template.id !== templateId));
      setInfo("Шаблон удалён");
    } catch (apiError) {
      setError(`Не удалось удалить шаблон: ${apiError.message || apiError}. Удалено локально.`);
      setTemplates((prev) => prev.filter((template) => template.id !== templateId));
    }
  };

  return (
    <>
      <section className="card">
        <header className="section-head">
          <div>
            <p className="eyebrow">Шаблоны</p>
            <h1>Галерея шаблонов</h1>
            <p className="muted">
              Управляйте набором макетов: следите за названиями, назначением и тегами, создавайте
              шаблоны по текстовым описаниям.
            </p>
          </div>
          <button className="primary" onClick={() => setDialogOpen(true)}>
            + Создать шаблон
          </button>
        </header>
        {(error || info) && <p className="status">{error || info}</p>}
        <div className="grid">
          <article className="card">
            <header className="section-head">
              <div>
                <p className="eyebrow">Описание → Генерация</p>
                <h2>Текстовое описание</h2>
                <p className="muted">Передайте краткое ТЗ, и шаблон будет создан или добавлен как черновик.</p>
              </div>
              <button className="ghost" onClick={loadTemplates} disabled={loading}>
                Обновить
              </button>
            </header>
            <form className="form" onSubmit={generateFromText}>
              <label>
                Текстовое ТЗ
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Например: карточка мероприятия с постером, датой и CTA"
                  value={textPrompt}
                  onChange={(event) => setTextPrompt(event.target.value)}
                  required
                />
              </label>
              <div className="actions">
                <button type="button" className="ghost" onClick={() => setTextPrompt("")}>
                  Очистить
                </button>
                <button type="submit" className="primary" disabled={generateLoading || !textPrompt.trim()}>
                  {generateLoading ? "Генерируем..." : "Сгенерировать"}
                </button>
              </div>
            </form>
          </article>
        </div>
      </section>

      <section className="card">
        <header className="section-head">
          <div>
            <p className="eyebrow">Список</p>
            <h2>Таблица шаблонов</h2>
            <p className="muted">Название, назначение и теги для быстрого поиска.</p>
          </div>
          <span className="muted">Всего: {templates.length}</span>
        </header>

        {loading ? (
          <p className="muted">Загружаем шаблоны...</p>
        ) : templates.length ? (
          <div className="table-wrapper">
            <table className="table templates-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Цель</th>
                  <th>Теги</th>
                  <th className="right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {sortedTemplates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <div className="template-title">
                        <span className="eyebrow">{template.id}</span>
                        <div className="template-name">{template.name}</div>
                        <p className="muted">{template.description}</p>
                      </div>
                    </td>
                    <td>{template.goal}</td>
                    <td>
                      {template.tags?.length ? (
                        <div className="tag-row">
                          {template.tags.map((tag) => (
                            <span key={`${template.id}-${tag}`} className="tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">Теги не заданы</span>
                      )}
                    </td>
                    <td className="right">
                      <div className="actions">
                        <button className="ghost" onClick={() => deleteTemplate(template.id)}>
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Пока нет шаблонов. Добавьте описание или создайте новый вручную.</p>
        )}
      </section>

      {dialogOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setDialogOpen(false)}>
          <div className="card modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="section-head">
              <div>
                <p className="eyebrow">Новый шаблон</p>
                <h2>Создание вручную</h2>
              </div>
              <button className="ghost" onClick={() => setDialogOpen(false)} aria-label="Закрыть">
                ✕
              </button>
            </header>

            <form className="form" onSubmit={submitTemplate}>
              <label>
                Название
                <input
                  name="name"
                  required
                  placeholder="Например, Шаблон тизера"
                  value={formData.name}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </label>

              <label>
                Цель
                <input
                  name="goal"
                  required
                  placeholder="Где и зачем используется шаблон"
                  value={formData.goal}
                  onChange={(event) => updateField("goal", event.target.value)}
                />
              </label>

              <label>
                Описание
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Коротко опишите структуру шаблона"
                  value={formData.description}
                  onChange={(event) => updateField("description", event.target.value)}
                />
              </label>

              <label>
                Теги
                <input
                  name="tags"
                  placeholder="Например: promo, ui, marketplace"
                  value={formData.tags}
                  onChange={(event) => updateField("tags", event.target.value)}
                />
              </label>

              <div className="actions">
                <button type="button" className="ghost" onClick={() => setDialogOpen(false)}>
                  Отмена
                </button>
                <button type="submit" className="primary" disabled={creating || !formData.name.trim() || !formData.goal.trim()}>
                  {creating ? "Сохраняем..." : "Создать"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default TemplatesPage;
