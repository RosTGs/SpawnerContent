import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useProject } from "../ProjectContext.jsx";
import { useSettings } from "../SettingsContext.jsx";
import { apiBases, downloadApi, requestApi } from "../api/client.js";
import { ASPECT_RATIOS, RESOLUTIONS } from "../constants/generation.js";

function normalizeAssetUrl(url) {
  if (!url) return null;

  if (/^https?:\/\//i.test(url) || url.startsWith("/api/")) {
    return url;
  }

  const base = apiBases[0] || "/api";
  const baseWithoutSlash = base.replace(/\/$/, "");
  const suffix = url.startsWith("/") ? url : `/${url}`;

  return `${baseWithoutSlash}${suffix}`;
}

function getFormStorageKey(projectId) {
  return projectId ? `generationForm:${projectId}` : null;
}

function readStoredForm(projectId) {
  if (typeof window === "undefined" || !projectId) return null;

  try {
    const raw = window.localStorage.getItem(getFormStorageKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function GeneratePage() {
  const { settings } = useSettings();
  const { selectedProject, setSelectedProject } = useProject();
  const { id: routeProjectId } = useParams();
  const location = useLocation();
  const defaultAspectRatio = settings.defaultAspectRatio || ASPECT_RATIOS[0];
  const defaultResolution = settings.defaultResolution || RESOLUTIONS[0];
  const [aspectRatio, setAspectRatio] = useState(() => {
    const stored = readStoredForm(routeProjectId);
    return stored?.aspectRatio || defaultAspectRatio;
  });
  const [resolution, setResolution] = useState(() => {
    const stored = readStoredForm(routeProjectId);
    return stored?.resolution || defaultResolution;
  });
  const [prompts, setPrompts] = useState(() => {
    const stored = readStoredForm(routeProjectId);
    return stored?.prompts?.length ? stored.prompts : [""];
  });
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadState, setDownloadState] = useState({});

  const projectFromState = location.state?.project;
  const effectiveProject =
    selectedProject || (routeProjectId && projectFromState?.id === routeProjectId ? projectFromState : null);

  const promptList = useMemo(() => prompts.filter(Boolean), [prompts]);

  useEffect(() => {
    if (projectFromState && (!selectedProject || selectedProject.id !== projectFromState.id)) {
      setSelectedProject(projectFromState);
    }
  }, [projectFromState, selectedProject, setSelectedProject]);

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);

    try {
      const { payload } = await requestApi("/status");
      setStatus(payload);
      setMessage("");
    } catch (error) {
      setMessage(`Не удалось получить статус: ${error.message || error}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!effectiveProject?.id) return;

    const stored = readStoredForm(effectiveProject.id);

    if (stored) {
      setAspectRatio(stored.aspectRatio || defaultAspectRatio);
      setResolution(stored.resolution || defaultResolution);
      setPrompts(stored.prompts?.length ? stored.prompts : [""]);
      return;
    }

    setAspectRatio(defaultAspectRatio);
    setResolution(defaultResolution);
    setPrompts((prev) => (prev.length ? prev : [""]));
  }, [defaultAspectRatio, defaultResolution, effectiveProject?.id]);

  useEffect(() => {
    if (typeof window === "undefined" || !effectiveProject?.id) return;

    const payload = {
      aspectRatio,
      resolution,
      prompts,
    };

    try {
      window.localStorage.setItem(getFormStorageKey(effectiveProject.id), JSON.stringify(payload));
    } catch (error) {
      /* noop */
    }
  }, [aspectRatio, effectiveProject?.id, prompts, resolution]);

  useEffect(() => {
    if (!status?.progress?.active) {
      return undefined;
    }

    const interval = setInterval(() => {
      refreshStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [refreshStatus, status?.progress?.active]);

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

    if (!settings.apiKey) {
      setMessage("Добавьте API-ключ в настройках перед запуском.");
      setLoading(false);
      return;
    }

    try {
      const { payload } = await requestApi("/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: settings.apiKey,
          aspect_ratio: aspectRatio,
          resolution,
          sheet_prompts: promptList,
          project_id: effectiveProject.id,
        }),
      });

      setMessage((payload && payload.message) || "Генерация запущена");
      refreshStatus();
    } catch (error) {
      setMessage(error.message || "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  };

  const toggleDownloadFlag = (key, value) => {
    setDownloadState((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const downloadPdf = async (generation) => {
    const key = `${generation.id}-pdf`;
    toggleDownloadFlag(key, true);

    try {
      await downloadApi(`/generations/${generation.id}/export_pdf`, {
        method: "POST",
        filename: `generation-${generation.id}.pdf`,
      });
      setMessage("");
    } catch (error) {
      setMessage(error.message || "Не удалось скачать PDF-файл");
    } finally {
      toggleDownloadFlag(key, false);
    }
  };

  const downloadImages = async (generation) => {
    const key = `${generation.id}-images`;
    toggleDownloadFlag(key, true);

    try {
      await downloadApi(`/generations/${generation.id}/images/archive`, {
        filename: `generation-${generation.id}-images.zip`,
      });
      setMessage("");
    } catch (error) {
      setMessage(error.message || "Не удалось скачать изображения");
    } finally {
      toggleDownloadFlag(key, false);
    }
  };

  const isDownloading = (key) => Boolean(downloadState[key]);

  if (!effectiveProject || (routeProjectId && effectiveProject.id !== routeProjectId)) {
    return <Navigate to="/project" replace />;
  }

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">Gemini Sheet Builder</p>
          <h1>API + SPA</h1>
          <p className="muted">
            Фронтенд собран через Vite и использует JSON-эндпоинты Flask под префиксом
            <code>/api</code>.
          </p>
          <p className="muted">
            Генерация листов листает очередь и возвращает ссылки на финальные ассеты после
            обработки.
          </p>
          <div className="inline-status">
            <div>
              <p className="eyebrow">Текущий проект</p>
              <p className="muted">Генерация запустится в контексте выбранного проекта.</p>
            </div>
            <span className="badge badge-success">{effectiveProject.name}</span>
          </div>
        </div>

        <div className="card">
          <h2>Запуск генерации</h2>
          <p className="muted">Передайте промты и ключ для запуска пайплайна Gemini.</p>

          <form className="form" onSubmit={submitGeneration}>
            <div className="inline-status">
              <div>
                <p className="eyebrow">API ключ</p>
                <p className="muted">
                  Ключ подтягивается из раздела настроек и передаётся при запуске.
                </p>
                {!settings.apiKey && (
                  <p className="status warning">Добавьте ключ на странице настроек.</p>
                )}
              </div>
              <span className={settings.apiKey ? "badge badge-success" : "badge badge-warning"}>
                {settings.apiKey ? "Сохранён" : "Не задан"}
              </span>
            </div>
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

            <button
              type="submit"
              className="primary"
              disabled={loading || promptList.length === 0 || !settings.apiKey}
            >
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
          <div className="inline-status">
            <span className="muted">
              {refreshing
                ? "Обновление статуса..."
                : status?.progress?.active
                  ? "Есть активные задачи"
                  : "Нет активных задач"}
            </span>
            <button className="ghost" onClick={refreshStatus} disabled={refreshing}>
              Обновить
            </button>
          </div>
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
                  <div className="generation-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => downloadPdf(generation)}
                      disabled={!generation.approved || isDownloading(`${generation.id}-pdf`)}
                    >
                      {isDownloading(`${generation.id}-pdf`) ? "Готовлю PDF..." : "Скачать PDF"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => downloadImages(generation)}
                      disabled={generation.ready === 0 || isDownloading(`${generation.id}-images`)}
                    >
                      {isDownloading(`${generation.id}-images`)
                        ? "Упаковываю файлы..."
                        : "Скачать изображения"}
                    </button>
                  </div>
                  <ul className="image-list">
                    {generation.images.map((image) => {
                      const assetUrl = normalizeAssetUrl(image.asset_url);

                      return (
                        <li key={image.index}>
                          <div className="image-row">
                            <span>
                              Карточка {image.index + 1} — {image.status}
                            </span>
                            <span className={image.approved ? "approved" : "muted"}>
                              {image.approved ? "апрув" : "ожидает"}
                            </span>
                          </div>
                          {assetUrl ? (
                            <a className="link" href={assetUrl} target="_blank" rel="noreferrer">
                              Открыть файл ({image.filename})
                            </a>
                          ) : (
                            <span className="muted">файл появится после генерации</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">Запустите сборку фронтенда и API, чтобы увидеть прогресс.</p>
        )}
      </section>
    </>
  );
}

export default GeneratePage;
