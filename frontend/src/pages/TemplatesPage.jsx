import { useEffect, useMemo, useState } from "react";
import { requestApi } from "../api/client";
import { MAX_UPLOAD_SIZE_BYTES, UPLOAD_LIMIT_LABEL } from "../constants/uploads";

const TEMPLATE_KINDS = [
  {
    id: "text",
    title: "Текстовый шаблон",
    helper: "Текстовые заготовки для генерации",
    contentLabel: "Текст шаблона",
    placeholder: "Например: описание героя, конфликт и нужный формат", 
    requiresFile: false,
  },
  {
    id: "background",
    title: "Фон",
    helper: "Добавляйте и храните изображения фонов",
    contentLabel: "Изображение фона",
    placeholder: "",
    requiresFile: true,
  },
  {
    id: "layout",
    title: "Шаблон расположения",
    helper: "Сетки и композиции как изображения",
    contentLabel: "Изображение расположения",
    placeholder: "",
    requiresFile: true,
  },
];

const mockTemplates = [
  {
    id: "hero-banner",
    name: "Герой лендинга",
    kind: "layout",
    description: "Шапка с CTA, крупным заголовком и кнопкой действия",
    content: "",
    asset_url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "ambient-space",
    name: "Космический фон",
    kind: "background",
    description: "Футуристичный фон с мягким свечением",
    content: "",
    asset_url: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "reminder-email",
    name: "Промт письма",
    kind: "text",
    description: "Тонкое письмо-напоминание",
    content: "Пиши дружелюбно, один призыв к действию, выдели выгоду возврата",
  },
];

function normalizeTemplate(template) {
  return {
    id: template.id || template.slug || crypto.randomUUID(),
    name: template.name || "Новый шаблон",
    kind: template.kind || template.category || "text",
    description: template.description || "Описание не заполнено",
    content: template.content || template.prompt || "",
    author: template.author || "",
    created_at: template.created_at || "",
    assetUrl: template.asset_url || template.assetUrl || "",
  };
}

function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [activeListKind, setActiveListKind] = useState("text");
  const [activeFormKind, setActiveFormKind] = useState("text");

  const makeEmptyForms = () =>
    TEMPLATE_KINDS.reduce(
      (acc, kind) => ({
        ...acc,
        [kind.id]: { name: "", description: "", content: "", file: null, preview: "" },
      }),
      {},
    );

  const [forms, setForms] = useState(makeEmptyForms);

  const sortedTemplates = useMemo(
    () =>
      [...templates].sort((a, b) => {
        const left = a.created_at || a.id;
        const right = b.created_at || b.id;
        return String(right).localeCompare(String(left));
      }),
    [templates],
  );

  const filteredTemplates = useMemo(
    () => sortedTemplates.filter((template) => template.kind === activeListKind),
    [sortedTemplates, activeListKind],
  );

  const activeFormKindConfig = useMemo(
    () => TEMPLATE_KINDS.find((kind) => kind.id === activeFormKind) || TEMPLATE_KINDS[0],
    [activeFormKind],
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

  const updateField = (kind, field, value) => {
    setForms((prev) => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        [field]: value,
      },
    }));
  };

  const handleFileChange = (kind, file) => {
    setError("");
    setInfo("");

    if (!file) {
      updateField(kind, "file", null);
      updateField(kind, "preview", "");
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      updateField(kind, "file", null);
      updateField(kind, "preview", "");
      setError(`Файл слишком большой. Максимальный размер — ${UPLOAD_LIMIT_LABEL}.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateField(kind, "preview", reader.result || "");
    };
    reader.readAsDataURL(file);
    updateField(kind, "file", file);
  };

  const submitTemplate = async (event, kind) => {
    event.preventDefault();
    setError("");
    setInfo("");

    const payload = {
      name: forms[kind].name.trim(),
      description: forms[kind].description.trim(),
      content: forms[kind].content.trim(),
      kind,
      category: kind,
    };

    if (!payload.name) {
      setError("Заполните название шаблона");
      return;
    }

    if (kind === "text" && !payload.content) {
      setError("Добавьте текст для шаблона");
      return;
    }

    if (kind !== "text" && !forms[kind].file) {
      setError("Добавьте изображение для этого шаблона");
      return;
    }

    try {
      let created;
      if (kind === "text") {
        const { payload: responsePayload } = await requestApi("/templates", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        created = normalizeTemplate(responsePayload?.template || responsePayload || payload);
      } else {
        const formData = new FormData();
        formData.append("name", payload.name);
        formData.append("description", payload.description);
        formData.append("kind", kind);
        formData.append("category", kind);
        formData.append("file", forms[kind].file);

        const { payload: responsePayload } = await requestApi("/templates", {
          method: "POST",
          body: formData,
        });
        created = normalizeTemplate(responsePayload?.template || responsePayload || payload);
      }

      setTemplates((prev) => [created, ...prev]);
      setForms(makeEmptyForms());
      setInfo("Шаблон сохранён");
    } catch (apiError) {
      const mockTemplate = normalizeTemplate({ ...payload, id: `mock-${Date.now()}` });
      setTemplates((prev) => [mockTemplate, ...prev]);
      setError(`Не удалось сохранить шаблон: ${apiError.message || apiError}. Добавлен мок.`);
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
            <h1>Каталог шаблонов</h1>
            <p className="muted">
              Добавляйте и сохраняйте текстовые промты, изображения фонов и схемы расположения контента. Все элементы
              сохраняются на сервере так же, как и ассеты.
            </p>
          </div>
          <button className="ghost" onClick={loadTemplates} disabled={loading}>
            Обновить
          </button>
        </header>
        {(error || info) && <p className="status">{error || info}</p>}

        <div className="template-tabs">
          {TEMPLATE_KINDS.map((kind) => (
            <button
              key={kind.id}
              className={activeFormKind === kind.id ? "tag active" : "tag"}
              type="button"
              onClick={() => setActiveFormKind(kind.id)}
            >
              {kind.title}
            </button>
          ))}
        </div>

        <div className="template-form-panel">
          <header className="section-head">
            <div>
              <p className="eyebrow">{activeFormKindConfig.title}</p>
              <h2>{activeFormKindConfig.helper}</h2>
            </div>
          </header>
          <form className="form" onSubmit={(event) => submitTemplate(event, activeFormKindConfig.id)}>
            <label>
              Название
              <input
                name={`name-${activeFormKindConfig.id}`}
                placeholder="Как вы будете находить этот шаблон"
                value={forms[activeFormKindConfig.id].name}
                onChange={(event) => updateField(activeFormKindConfig.id, "name", event.target.value)}
              />
            </label>
            {activeFormKindConfig.requiresFile ? (
              <label>
                {activeFormKindConfig.contentLabel}
                <input
                  type="file"
                  name={`file-${activeFormKindConfig.id}`}
                  accept="image/*"
                  onChange={(event) => handleFileChange(activeFormKindConfig.id, event.target.files?.[0])}
                />
                {forms[activeFormKindConfig.id].preview && (
                  <img
                    src={forms[activeFormKindConfig.id].preview}
                    alt="Превью шаблона"
                    style={{ marginTop: "0.5rem", borderRadius: "0.5rem", maxHeight: "180px" }}
                  />
                )}
              </label>
            ) : (
              <label>
                {activeFormKindConfig.contentLabel}
                <textarea
                  name={`content-${activeFormKindConfig.id}`}
                  rows={3}
                  placeholder={activeFormKindConfig.placeholder}
                  value={forms[activeFormKindConfig.id].content}
                  onChange={(event) => updateField(activeFormKindConfig.id, "content", event.target.value)}
                />
              </label>
            )}
            <label>
              Описание
              <textarea
                name={`description-${activeFormKindConfig.id}`}
                rows={2}
                placeholder="Коротко поясните, где применять шаблон"
                value={forms[activeFormKindConfig.id].description}
                onChange={(event) => updateField(activeFormKindConfig.id, "description", event.target.value)}
              />
            </label>
            <div className="actions">
              <button type="reset" className="ghost" onClick={() => setForms(makeEmptyForms())}>
                Очистить
              </button>
              <button
                type="submit"
                className="primary"
                disabled={
                  !forms[activeFormKindConfig.id].name.trim() ||
                  (activeFormKindConfig.requiresFile
                    ? !forms[activeFormKindConfig.id].file
                    : !forms[activeFormKindConfig.id].content.trim())
                }
              >
                Сохранить
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <header className="section-head">
          <div>
            <p className="eyebrow">Список</p>
            <h2>Шаблоны по категориям</h2>
            <p className="muted">Выберите категорию, чтобы увидеть и удалить сохранённые элементы.</p>
          </div>
          <div className="filters">
            {TEMPLATE_KINDS.map((kind) => (
              <button
                key={kind.id}
                className={activeListKind === kind.id ? "tag active" : "tag"}
                type="button"
                onClick={() => setActiveListKind(kind.id)}
              >
                {kind.title}
              </button>
            ))}
          </div>
        </header>

        {loading ? (
          <p className="muted">Загружаем шаблоны...</p>
        ) : filteredTemplates.length ? (
          <div className="table-wrapper">
            <table className="table templates-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Описание</th>
                  <th>Содержимое</th>
                  <th className="right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <div className="template-title">
                        <span className="eyebrow">{template.id}</span>
                        <div className="template-name">{template.name}</div>
                        <p className="muted">Тип: {template.kind}</p>
                      </div>
                    </td>
                    <td>{template.description}</td>
                    <td>
                      {template.kind === "text" ? (
                        template.content ? (
                          <div className="template-content">{template.content}</div>
                        ) : (
                          <span className="muted">Нет содержимого</span>
                        )
                      ) : template.assetUrl || template.content ? (
                        <img
                          src={template.assetUrl || template.content}
                          alt={template.name}
                          style={{ maxHeight: "120px", borderRadius: "0.5rem" }}
                        />
                      ) : (
                        <span className="muted">Нет изображения</span>
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
          <p className="muted">Пока нет шаблонов в этой категории. Добавьте новый выше.</p>
        )}
      </section>
    </>
  );
}

export default TemplatesPage;
