import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { requestApi } from "./api/client.js";
import { ASPECT_RATIOS, RESOLUTIONS } from "./constants/generation.js";

const STORAGE_KEY = "geminiSheetSettings";

const defaultSettings = {
  apiKey: "",
  assetsPath: "/data/assets",
  outputPath: "/data/output",
  templatesPath: "/data/templates",
  defaultAspectRatio: ASPECT_RATIOS[0],
  defaultResolution: RESOLUTIONS[0],
  defaultSteps: 20,
  uiTheme: "system",
  uiDensity: "comfortable",
  showHints: true,
};

const SettingsContext = createContext();

function readFromStorage() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Не удалось прочитать настройки", error);
    return null;
  }
}

async function persistToApi(payload) {
  try {
    await requestApi("/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || "Не удалось сохранить через API" };
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => ({
    ...defaultSettings,
    ...(readFromStorage() || {}),
  }));
  const [saveState, setSaveState] = useState({ status: "idle", message: "" });

  useEffect(() => {
    const stored = readFromStorage();
    if (stored) {
      setSettings((prev) => ({ ...prev, ...stored }));
    }
  }, []);

  const saveSettings = async (nextSettings) => {
    setSaveState({ status: "saving", message: "Сохраняю настройки..." });

    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
      }
      setSettings(nextSettings);
      const apiResult = await persistToApi(nextSettings);
      if (!apiResult.ok) {
        setSaveState({
          status: "warning",
          message: `Сохранено локально, но не удалось отправить на API: ${apiResult.message}`,
        });
        return;
      }

      setSaveState({ status: "success", message: "Настройки сохранены" });
    } catch (error) {
      setSaveState({
        status: "error",
        message: error?.message || "Не удалось сохранить настройки",
      });
    }
  };

  const value = useMemo(
    () => ({ settings, saveSettings, saveState, defaultSettings }),
    [settings, saveState],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings должен использоваться внутри SettingsProvider");
  }
  return ctx;
}
