import { useEffect, useMemo, useState } from "react";

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const RESOLUTIONS = ["1K", "2K", "4K"];

function App() {
  const [apiKey, setApiKey] = useState("");
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0]);
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [prompts, setPrompts] = useState([""]);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const promptList = useMemo(() => prompts.filter(Boolean), [prompts]);

  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = async () => {
    try {
      const response = await fetch("/api/status");
      if (!response.ok) {
        const fallback = await response.text();
        throw new Error(fallback || `Не удалось получить статус (HTTP ${response.status})`);
      }

      const payload = await response.json();
      setStatus(payload);
      setMessage("");
    } catch (error) {
      setMessage(`Не удалось получить статус: ${error.message || error}`);
    }
  };

  const updatePrompt = (index, value) => {
    const next = [...prompts];
    next[index] = value;
    setPrompts(next);
  };

  const addPrompt = () => setPrompts([...prompts, ""]);

  const removePrompt = (index) => {
    const next = prompts.filter((_, idx) => idx !== index);
    setPrompts(next.length ? next : [""]);
  };

  const submitGeneration = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: apiKey,
          aspect_ratio: aspectRatio,
          resolution,
          sheet_prompts: promptList,
        }),
      });

      const payload = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const errorMessage =
          typeof payload === "string"
            ? payload || "Ошибка запуска генерации"
            : payload.error || "Ошибка запуска генерации";
        throw new Error(errorMessage);
      }

      setMessage((payload && payload.message) || "Генерация запущена");
      refreshStatus();
    } catch (error) {
      setMessage(error.message || "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Gemini Sheet Builder</p>
          <h1>API + SPA</h1>
          <p className="muted">
            Фронтенд собран через Vite и использует JSON-эндпоинты Flask под префиксом
            <code>/api</code>.
          </p>
        </div>
        <div className="card">
          <p className="eyebrow">Параметры генерации</p>
          <form className="form" onSubmit={submitGeneration}>
            <label>
              API ключ Gemini
              <input
                type="password"
                placeholder="GEMINI_API_KEY"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <label>
              Соотношение сторон
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
                {ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Разрешение
              <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
                {RESOLUTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <div className="prompts">
              <div className="prompt-head">
                <span>Блоки промта</span>
                <button type="button" className="link" onClick={addPrompt}>
                  + Добавить
                </button>
              </div>
              {prompts.map((prompt, index) => (
                <div key={index} className="prompt-line">
                  <textarea
                    rows={2}
                    placeholder={`Текст для листа ${index + 1}`}
                    value={prompt}
                    onChange={(event) => updatePrompt(index, event.target.value)}
                  />
                  {prompts.length > 1 && (
                    <button
                      type="button"
                      aria-label="Удалить"
                      className="ghost"
                      onClick={() => removePrompt(index)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button type="submit" className="primary" disabled={loading || promptList.length === 0}>
              {loading ? "Запускаю..." : "Запустить генерацию"}
            </button>
            {message && <p className="status">{message}</p>}
          </form>
        </div>
      </header>

      <section className="card">
        <header className="section-head">
          <div>
            <p className="eyebrow">Мониторинг</p>
            <h2>Активные и завершённые генерации</h2>
          </div>
          <button className="ghost" onClick={refreshStatus}>
            Обновить
          </button>
        </header>
        {status ? (
          <>
            <div className="progress">
              <span>Всего: {status.progress.total}</span>
              <span>Готово: {status.progress.completed}</span>
              <span>В работе: {status.progress.active}</span>
            </div>
            <div className="grid">
              {status.generations.map((generation) => (
                <article className="card generation" key={generation.id}>
                  <header className="generation-head">
                    <div>
                      <p className="eyebrow">#{generation.id}</p>
                      <h3>{generation.status_label}</h3>
                    </div>
                    <span className={`badge badge-${generation.status}`}>
                      {generation.ready}/{generation.total}
                    </span>
                  </header>
                  <ul className="image-list">
                    {generation.images.map((image) => (
                      <li key={image.index}>
                        <div className="image-row">
                          <span>
                            Карточка {image.index + 1} — {image.status}
                          </span>
                          <span className={image.approved ? "approved" : "muted"}>
                            {image.approved ? "апрув" : "ожидает"}
                          </span>
                        </div>
                        {image.asset_url ? (
                          <a className="link" href={image.asset_url} target="_blank" rel="noreferrer">
                            Открыть файл ({image.filename})
                          </a>
                        ) : (
                          <span className="muted">файл появится после генерации</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">Запустите сборку фронтенда и API, чтобы увидеть прогресс.</p>
        )}
      </section>
    </main>
  );
}

export default App;
