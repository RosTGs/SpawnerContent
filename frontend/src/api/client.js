const apiBases = (() => {
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
