export const apiBases = (() => {
  const candidates = ["/api"];
  const baseFromVite = import.meta.env.BASE_URL;

  if (baseFromVite && baseFromVite !== "/" && baseFromVite !== "./") {
    candidates.push(`${baseFromVite.replace(/\/$/, "")}/api`);
  }

  return Array.from(new Set(candidates));
})();

export async function requestApi(path, options = {}) {
  let lastError = null;

  for (const base of apiBases) {
    const url = `${base}${path}`;

    try {
      const response = await fetch(url, options);
      const isJson = response.headers
        .get("content-type")
        ?.includes("application/json");

      const payload = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const message = (() => {
          if (response.status === 413) {
            return "Файл слишком большой для загрузки. Уменьшите размер и попробуйте снова.";
          }

          if (typeof payload === "string") {
            return payload || `HTTP ${response.status}`;
          }

          return payload?.error || `HTTP ${response.status}`;
        })();

        throw new Error(message);
      }

      return { response, payload };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось выполнить запрос к API");
}

function extractFilename(response, fallback) {
  const header = response.headers.get("content-disposition");
  if (!header) return fallback;

  const filenameMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (filenameMatch?.[1]) {
    return decodeURIComponent(filenameMatch[1]);
  }

  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return fallback;
}

export async function downloadApi(path, options = {}) {
  let lastError = null;

  for (const base of apiBases) {
    const url = `${base}${path}`;

    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers: options.headers,
        body: options.body,
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const errorMessage = contentType.includes("application/json")
          ? (await response.json()).error || `HTTP ${response.status}`
          : (await response.text()) || `HTTP ${response.status}`;
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const derivedName = options.filename || extractFilename(response, path.split("/").pop() || "download");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = derivedName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Не удалось скачать файл");
}
