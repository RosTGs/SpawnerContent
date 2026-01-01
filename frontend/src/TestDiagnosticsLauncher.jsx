import { useMemo, useState } from "react";
import { requestApi } from "./api/client";

const truncate = (value, limit = 3200) => {
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit)}\n...` : value;
};

export default function TestDiagnosticsLauncher() {
  const [isVisible, setIsVisible] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState(null);
  const [error, setError] = useState(null);

  const statusLabel = useMemo(() => {
    if (isRunning) return "Запуск тестов...";
    if (!output) return "Диагностика";
    return output.exit_code === 0 ? "Тесты пройдены" : "Есть ошибки";
  }, [isRunning, output]);

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const { payload } = await requestApi("/tests/run", { method: "POST" });
      setOutput(payload);
      setIsVisible(true);
    } catch (err) {
      setError(err.message || "Не удалось запустить тесты");
      setIsVisible(true);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="diagnostics-launcher" aria-live="polite">
      <button
        type="button"
        className={"diagnostics-button" + (isRunning ? " is-running" : "")}
        onClick={handleRun}
        disabled={isRunning}
        title="Запустить backend-тесты"
      >
        {statusLabel}
      </button>

      {isVisible && (
        <div className="diagnostics-panel">
          <div className="diagnostics-panel__header">
            <div>
              <p className="eyebrow">Быстрая проверка</p>
              <strong>Результаты backend-тестов</strong>
            </div>
            <button
              type="button"
              className="diagnostics-panel__close"
              onClick={() => setIsVisible(false)}
              aria-label="Скрыть результаты"
            >
              ×
            </button>
          </div>

          {error && <p className="diagnostics-panel__error">{error}</p>}

          {output && (
            <div className="diagnostics-panel__body">
              <div className="diagnostics-meta">
                <span className={output.exit_code === 0 ? "ok" : "fail"}>
                  Код: {output.exit_code}
                </span>
                <span>Время: {output.duration}s</span>
              </div>
              <label className="diagnostics-block">
                <span>Stdout</span>
                <pre>{truncate(output.stdout) || "(пусто)"}</pre>
              </label>
              {output.stderr && (
                <label className="diagnostics-block">
                  <span>Stderr</span>
                  <pre>{truncate(output.stderr)}</pre>
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
