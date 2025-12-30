import { useEffect, useMemo, useState } from "react";
import { useSettings } from "../SettingsContext.jsx";
import { ASPECT_RATIOS, RESOLUTIONS } from "../constants/generation.js";

function SettingsPage() {
  const { settings, saveSettings, saveState, defaultSettings } = useSettings();
  const [formState, setFormState] = useState(settings);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  const validationErrors = useMemo(() => errors, [errors]);

  const handleChange = (field, value) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const validate = () => {
    const nextErrors = {};

    if (!formState.apiKey || formState.apiKey.length < 8) {
      nextErrors.apiKey = "Добавьте корректный API-ключ (не короче 8 символов)";
    }

    ["assetsPath", "outputPath", "templatesPath"].forEach((pathField) => {
      if (!formState[pathField] || formState[pathField].trim().length < 2) {
        nextErrors[pathField] = "Заполните путь";
      }
    });

    if (!ASPECT_RATIOS.includes(formState.defaultAspectRatio)) {
      nextErrors.defaultAspectRatio = "Выберите значение из списка";
    }

    if (!RESOLUTIONS.includes(formState.defaultResolution)) {
      nextErrors.defaultResolution = "Выберите значение из списка";
    }

    const numericSteps = Number(formState.defaultSteps);
    if (!Number.isFinite(numericSteps) || numericSteps <= 0) {
      nextErrors.defaultSteps = "Задайте число шагов больше нуля";
    }

    return nextErrors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const normalized = {
      ...formState,
      defaultSteps: Number(formState.defaultSteps),
      showHints: Boolean(formState.showHints),
    };

    await saveSettings(normalized);
  };

  const statusClassName =
    saveState.status === "success"
      ? "badge badge-success"
      : saveState.status === "warning"
        ? "badge badge-warning"
        : saveState.status === "error"
          ? "badge badge-error"
          : "badge badge-pending";

  return (
    <section className="card settings">
      <p className="eyebrow">Настройки</p>
      <h1>Параметры окружения</h1>
      <p className="muted">
        Храните ключи, пути до ассетов и значения по умолчанию, которые используются при генерации.
        Эти данные сохраняются локально и могут быть отправлены в API.
      </p>

      <form className="form settings-form" onSubmit={handleSubmit}>
        <div className="settings-grid">
          <div className="settings-block">
            <p className="eyebrow">API-ключи</p>
            <h2>Подключения</h2>
            <label>
              Ключ Gemini
              <input
                type="password"
                placeholder="sk-..."
                value={formState.apiKey}
                onChange={(event) => handleChange("apiKey", event.target.value)}
              />
              {validationErrors.apiKey && <span className="field-error">{validationErrors.apiKey}</span>}
            </label>
          </div>

          <div className="settings-block">
            <p className="eyebrow">Пути</p>
            <h2>Директории и вывод</h2>
            <label>
              Путь до ассетов
              <input
                type="text"
                value={formState.assetsPath}
                onChange={(event) => handleChange("assetsPath", event.target.value)}
              />
              {validationErrors.assetsPath && (
                <span className="field-error">{validationErrors.assetsPath}</span>
              )}
            </label>
            <label>
              Путь выгрузки
              <input
                type="text"
                value={formState.outputPath}
                onChange={(event) => handleChange("outputPath", event.target.value)}
              />
              {validationErrors.outputPath && (
                <span className="field-error">{validationErrors.outputPath}</span>
              )}
            </label>
            <label>
              Путь до шаблонов
              <input
                type="text"
                value={formState.templatesPath}
                onChange={(event) => handleChange("templatesPath", event.target.value)}
              />
              {validationErrors.templatesPath && (
                <span className="field-error">{validationErrors.templatesPath}</span>
              )}
            </label>
          </div>

          <div className="settings-block">
            <p className="eyebrow">Параметры генерации</p>
            <h2>Значения по умолчанию</h2>
            <label>
              Соотношение сторон
              <select
                value={formState.defaultAspectRatio}
                onChange={(event) => handleChange("defaultAspectRatio", event.target.value)}
              >
                {ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
              {validationErrors.defaultAspectRatio && (
                <span className="field-error">{validationErrors.defaultAspectRatio}</span>
              )}
            </label>
            <label>
              Разрешение
              <select
                value={formState.defaultResolution}
                onChange={(event) => handleChange("defaultResolution", event.target.value)}
              >
                {RESOLUTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {validationErrors.defaultResolution && (
                <span className="field-error">{validationErrors.defaultResolution}</span>
              )}
            </label>
            <label>
              Количество шагов
              <input
                type="number"
                min="1"
                value={formState.defaultSteps}
                onChange={(event) => handleChange("defaultSteps", event.target.value)}
              />
              {validationErrors.defaultSteps && (
                <span className="field-error">{validationErrors.defaultSteps}</span>
              )}
            </label>
          </div>

          <div className="settings-block">
            <p className="eyebrow">UI</p>
            <h2>Предпочтения</h2>
            <label>
              Тема
              <select
                value={formState.uiTheme}
                onChange={(event) => handleChange("uiTheme", event.target.value)}
              >
                <option value="system">Системная</option>
                <option value="dark">Тёмная</option>
                <option value="light">Светлая</option>
              </select>
            </label>
            <label>
              Плотность интерфейса
              <select
                value={formState.uiDensity}
                onChange={(event) => handleChange("uiDensity", event.target.value)}
              >
                <option value="comfortable">Обычная</option>
                <option value="compact">Компактная</option>
              </select>
            </label>
            <label className="inline">
              <span>Подсказки и рекомендации</span>
              <input
                type="checkbox"
                checked={formState.showHints}
                onChange={(event) => handleChange("showHints", event.target.checked)}
              />
            </label>
            <p className="muted">
              Интерфейсные предпочтения сохраняются вместе с остальными настройками, чтобы держать UI
              в едином состоянии на всех вкладках.
            </p>
          </div>
        </div>

        <div className="settings-footer">
          <div className="defaults">
            <p className="eyebrow">Значения по умолчанию</p>
            <p className="muted">
              Можно быстро сбросить форму к дефолтным значениям, которые поставляются с приложением.
            </p>
            <button type="button" className="ghost" onClick={() => setFormState({ ...defaultSettings })}>
              Вернуть значения
            </button>
          </div>
          <div className="save-actions">
            <p className="muted">Все изменения сохраняются в localStorage и при наличии API.</p>
            <button type="submit" className="primary" disabled={saveState.status === "saving"}>
              {saveState.status === "saving" ? "Сохраняю..." : "Сохранить"}
            </button>
            {saveState.message && <span className={statusClassName}>{saveState.message}</span>}
          </div>
        </div>
      </form>
    </section>
  );
}

export default SettingsPage;
