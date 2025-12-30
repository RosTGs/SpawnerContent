import { useEffect, useMemo, useState } from "react";

const apiBases = (() => {
  const candidates = ["/api"];
  const baseFromVite = import.meta.env.BASE_URL;

  if (baseFromVite && baseFromVite !== "/" && baseFromVite !== "./") {
    candidates.push(`${baseFromVite.replace(/\/$/, "")}/api`);
  }

  return Array.from(new Set(candidates));
})();

const TEMPLATE_KINDS = [
  {
    id: "text",
    title: "Текстовый шаблон",
    helper: "Скрытые промты и текстовые заготовки для генерации",
    contentLabel: "Скрытый промт или текст",
    placeholder: "Например: расскажи про героя в стиле синопсиса, выдели ключевой конфликт",
  },
  {
    id: "background",
    title: "Шаблон фона",
    helper: "Описание референсов или бэкграунда, которые нужно сохранить",
    contentLabel: "Описание фона",
    placeholder: "Например: холодный космос, звёздное небо, неоновые вывески",
  },
  {
    id: "layout",
    title: "Шаблон расположения",
    helper: "Композиции и сетки для размещения контента",
    contentLabel: "Описание сетки/композиции",
    placeholder: "Например: две колонки, слева иллюстрация, справа текст и кнопка",
  },
];

const mockTemplates = [
  {
    id: "hero-banner",
    name: "Герой лендинга",
    kind: "layout",
    description: "Шапка с CTA, крупным заголовком и кнопкой действия",
    content: "Сетка 60/40: слева иллюстрация, справа текст + две кнопки",
  },
  {
    id: "ambient-space",
    name: "Космический фон",
    kind: "background",
    description: "Футуристичный фон с мягким свечением",
    content: "Глубокий синий, фиолетовые прожилки, мягкое неоновое свечение",
  },
  {
    id: "reminder-email",
    name: "Промт письма",
    kind: "text",
    description: "Тонкое письмо-напоминание",
    content: "Пиши дружелюбно, один призыв к действию, выдели выгоду возврата",
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
  return {
    id: template.id || template.slug || crypto.randomUUID(),
    name: template.name || "Новый шаблон",
    kind: template.kind || template.category || "text",
    description: template.description || "Описание не заполнено",
    content: template.content || template.prompt || "",
    author: template.author || "",
    created_at: template.created_at || "",
  };
}

function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [textPrompt, setTextPrompt] = useState("");
  const [generateLoading, setGenerateLoading] = useState(false);
  const [activeKind, setActiveKind] = useState("text");

  const makeEmptyForms = () =>
    TEMPLATE_KINDS.reduce(
      (acc, kind) => ({
        ...acc,
        [kind.id]: { name: "", description: "", content: "" },
      }),
      {},
    );

  const [forms, setForms] = useState(makeEmptyForms);

  const sortedTemplates = useMemo(
    () =>
      [...templates].sort((left, right) => {
        if (left.kind === right.kind) {
          return left.name.localeCompare(right.name);
        }
        return left.kind.localeCompare(right.kind);
      }),
    [templates],
  );

  const filteredTemplates = useMemo(
    () => sortedTemplates.filter((template) => template.kind === activeKind),
    [sortedTemplates, activeKind],
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

    if (!payload.name || !payload.content) {
      setError("Заполните название и содержание шаблона");
      return;
    }

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
      setForms(makeEmptyForms());
      setInfo("Шаблон сохранён");
    } catch (apiError) {
      const mockTemplate = normalizeTemplate({ ...payload, id: `mock-${Date.now()}` });
      setTemplates((prev) => [mockTemplate, ...prev]);
      setError(`Не удалось сохранить шаблон: ${apiError.message || apiError}. Добавлен мок.`);
    }
  };

  const generateFromText = async (event) => {
    event.preventDefault();
    if (!textPrompt.trim()) return;

    setGenerateLoading(true);
    setError("");
    setInfo("");

    try {
      const { payload } = await requestApi("/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `Текстовый шаблон ${new Date().toLocaleTimeString()}`,
          description: "Создано по текстовому описанию",
          content: textPrompt.trim(),
          kind: "text",
          category: "text",
        }),
      });

      const generated = normalizeTemplate(payload?.template || payload);
      setTemplates((prev) => [generated, ...prev]);
      setTextPrompt("");
      setInfo("Шаблон создан по описанию");
    } catch (apiError) {
      const draft = normalizeTemplate({
        id: `draft-${Date.now()}`,
        name: textPrompt.slice(0, 40) || "Черновик шаблона",
        kind: "text",
        description: "Создан локально",
        content: textPrompt,
      });
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
            <h1>Каталог шаблонов</h1>
            <p className="muted">
              Добавляйте и сохраняйте текстовые промты, стили фонов и схемы расположения контента. Все
              элементы сохраняются на сервере так же, как и ассеты.
            </p>
          </div>
          <button className="ghost" onClick={loadTemplates} disabled={loading}>
            Обновить
          </button>
        </header>
        {(error || info) && <p className="status">{error || info}</p>}

        <div className="grid">
          {TEMPLATE_KINDS.map((kind) => (
            <article key={kind.id} className="card">
              <header className="section-head">
                <div>
                  <p className="eyebrow">{kind.title}</p>
                  <h2>{kind.helper}</h2>
                </div>
              </header>
              <form className="form" onSubmit={(event) => submitTemplate(event, kind.id)}>
                <label>
                  Название
                  <input
                    name={`name-${kind.id}`}
                    placeholder="Как вы будете находить этот шаблон"
                    value={forms[kind.id].name}
                    onChange={(event) => updateField(kind.id, "name", event.target.value)}
                  />
                </label>
                <label>
                  {kind.contentLabel}
                  <textarea
                    name={`content-${kind.id}`}
                    rows={3}
                    placeholder={kind.placeholder}
                    value={forms[kind.id].content}
                    onChange={(event) => updateField(kind.id, "content", event.target.value)}
                  />
                </label>
                <label>
                  Описание
                  <textarea
                    name={`description-${kind.id}`}
                    rows={2}
                    placeholder="Коротко поясните, где применять шаблон"
                    value={forms[kind.id].description}
                    onChange={(event) => updateField(kind.id, "description", event.target.value)}
                  />
                </label>
                <div className="actions">
                  <button type="reset" className="ghost" onClick={() => setForms(makeEmptyForms())}>
                    Очистить
                  </button>
                  <button type="submit" className="primary" disabled={!forms[kind.id].name.trim() || !forms[kind.id].content.trim()}>
                    Сохранить
                  </button>
                </div>
              </form>
            </article>
          ))}

          <article className="card">
            <header className="section-head">
              <div>
                <p className="eyebrow">Описание → Шаблон</p>
                <h2>Сгенерировать текстовый</h2>
                <p className="muted">Краткое ТЗ превратится в текстовый шаблон со скрытым промтом.</p>
              </div>
            </header>
            <form className="form" onSubmit={generateFromText}>
              <label>
                Текстовое ТЗ
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Например: письмо с приветствием, напомнить об акции, одна кнопка"
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
            <h2>Шаблоны по категориям</h2>
            <p className="muted">Выберите категорию, чтобы увидеть и удалить сохранённые элементы.</p>
          </div>
          <div className="filters">
            {TEMPLATE_KINDS.map((kind) => (
              <button
                key={kind.id}
                className={activeKind === kind.id ? "tag active" : "tag"}
                type="button"
                onClick={() => setActiveKind(kind.id)}
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
                      {template.content ? (
                        <div className="template-content">{template.content}</div>
                      ) : (
                        <span className="muted">Нет содержимого</span>
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
