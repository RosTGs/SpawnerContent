const I18N = window.I18N || {};

function t(key, fallback = "") {
  return key.split(".").reduce((acc, part) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, part)) {
      return acc[part];
    }
    return undefined;
  }, I18N) ?? fallback;
}

function format(message, values = {}) {
  return Object.entries(values).reduce(
    (acc, [name, value]) => acc.replace(new RegExp(`{${name}}`, "g"), value),
    message,
  );
}

function setActiveNav(page) {
  document.querySelectorAll(".nav-link").forEach((link) => {
    const route = link.dataset.route;
    if (route === page) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

async function fetchJSON(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(url, {
    headers: { ...headers, ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || t("js.misc.error_default", t("common.request_failed")));
  }
  return payload;
}

function parseIds(rawValue) {
  if (!rawValue) return [];
  return rawValue
    .toString()
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => !Number.isNaN(value));
}

async function deleteProject(projectId) {
  try {
    await fetchJSON(`/api/projects/${projectId}`, { method: "DELETE" });
    loadProjects();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteTemplate(templateId) {
  try {
    await fetchJSON(`/api/templates/${templateId}`, { method: "DELETE" });
    loadTemplates();
    loadProjects();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteAsset(assetId) {
  try {
    await fetchJSON(`/api/assets/${assetId}`, { method: "DELETE" });
    loadAssets();
    loadProjects();
  } catch (error) {
    alert(error.message);
  }
}

function renderProjects(projects) {
  const list = document.getElementById("projects-list");
  const counter = document.getElementById("project-counter");
  if (!list) return;
  list.innerHTML = "";
  counter.textContent = format(t("js.counters.projects_count", `${projects.length}`), {
    count: projects.length,
    suffix: t("common.pieces_suffix", "шт."),
  });
  projects.forEach((project) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div class="stack" style="gap: 0.25rem">
          <strong>${project.name}</strong>
          <span class="muted">${project.description || t("common.no_description")}</span>
          <small class="muted">${t("projects.templates_label")}: ${project.templates} · ${t("projects.assets_label")}: ${project.assets}</small>
          <small class="muted">${project.author || t("common.no_author", "")}</small>
          <small class="muted">${project.created_at || ""}</small>
        </div>
        <div class="stack" style="align-items: flex-end">
          <span class="badge">${project.status}</span>
          <button class="secondary" data-project-delete="${project.id}">${t("common.delete", "Удалить")}</button>
        </div>
      </div>`;
    item.querySelector("[data-project-delete]")?.addEventListener("click", () => deleteProject(project.id));
    list.appendChild(item);
  });
}

function renderTemplates(templates) {
  const list = document.getElementById("templates-list");
  const counter = document.getElementById("template-counter");
  if (!list) return;
  list.innerHTML = "";
  counter.textContent = format(t("js.counters.templates_count", `${templates.length}`), {
    count: templates.length,
    suffix: t("common.items_suffix", "шт."),
  });
  templates.forEach((tpl) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div class="stack" style="gap: 0.25rem">
          <strong>${tpl.name}</strong>
          <span class="muted">${tpl.category || t("common.no_category")}</span>
          <span class="muted">${tpl.description || t("common.no_description")}</span>
          <small class="muted">${tpl.author || t("common.no_author", "")}</small>
          <small class="muted">${tpl.created_at || ""}</small>
        </div>
        <div class="stack" style="align-items: flex-end">
          <span class="pill">${format(
            t("js.templates.used_by", `${tpl.used_by}`),
            { count: tpl.used_by },
          )}</span>
          <button class="secondary" data-template-delete="${tpl.id}">${t("common.delete", "Удалить")}</button>
        </div>
      </div>`;
    item
      .querySelector("[data-template-delete]")
      ?.addEventListener("click", () => deleteTemplate(tpl.id));
    list.appendChild(item);
  });
}

function renderAssets(assets) {
  const list = document.getElementById("assets-list");
  const counter = document.getElementById("asset-counter");
  if (!list) return;
  list.innerHTML = "";
  counter.textContent = format(t("js.counters.assets_count", `${assets.length}`), {
    count: assets.length,
    suffix: t("common.pieces_suffix", "шт."),
  });
  assets.forEach((asset) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div class="stack" style="gap: 0.25rem">
          <strong>${asset.filename}</strong>
          <span class="muted">${asset.kind}</span>
          <small class="muted">${asset.description || t("common.no_description")}</small>
          <small class="muted">${asset.author || t("common.no_author", "")}</small>
          <small class="muted">${asset.created_at || ""}</small>
          ${asset.asset_url ? `<a class="link" href="${asset.asset_url}" target="_blank" rel="noreferrer">${t("assets.open", "Открыть")}</a>` : ""}
        </div>
        <div class="stack" style="align-items: flex-end">
          <span class="pill">${format(t("js.assets.size", `${asset.size}`), {
            size: asset.size,
          })}</span>
          <span class="pill">${format(t("js.assets.projects", `${asset.project_count}`), {
            count: asset.project_count,
          })}</span>
          <button class="secondary" data-asset-delete="${asset.id}">${t("common.delete", "Удалить")}</button>
        </div>
      </div>`;
    item.querySelector("[data-asset-delete]")?.addEventListener("click", () => deleteAsset(asset.id));
    list.appendChild(item);
  });
}

function renderSettings(payload) {
  const form = document.getElementById("settings-form");
  if (!form) return;
  form.saved_api_key.value = payload.api_key || "";
  form.background_references.value = payload.background_references.join(", ");
  form.detail_references.value = payload.detail_references.join(", ");
}

function renderStatus(status) {
  const container = document.getElementById("status-summary");
  if (!container) return;
  container.innerHTML = "";
  if (!status) {
    container.innerHTML = `<p class="muted">${t("js.misc.no_data", t("common.no_data"))}</p>`;
    return;
  }
  const total = document.createElement("p");
  total.textContent = format(t("js.status.total", `${status.progress.total}`), {
    total: status.progress.total,
  });
  const completed = document.createElement("p");
  completed.textContent = format(
    t("js.status.completed", `${status.progress.completed}`),
    {
      completed: status.progress.completed,
      active: status.progress.active,
    },
  );
  container.append(total, completed);
}

async function loadProjects() {
  try {
    const data = await fetchJSON("/api/projects");
    renderProjects(data.projects);
  } catch (error) {
    console.error(error);
  }
}

async function loadTemplates() {
  try {
    const data = await fetchJSON("/api/templates");
    renderTemplates(data.templates);
  } catch (error) {
    console.error(error);
  }
}

async function loadAssets() {
  try {
    const data = await fetchJSON("/api/assets");
    renderAssets(data.assets);
  } catch (error) {
    console.error(error);
  }
}

async function loadSettings() {
  try {
    const data = await fetchJSON("/api/settings");
    renderSettings(data.settings);
    renderStatus(data.status);
  } catch (error) {
    console.error(error);
  }
}

function registerForms(page) {
  if (page === "projects") {
    const form = document.getElementById("project-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const name = formData.get("name");
      if (!name) return;
      const description = formData.get("description") || "";
      const author = formData.get("author") || "";
      const templateIds = parseIds(formData.get("template_ids"));
      const assetIds = parseIds(formData.get("asset_ids"));
      try {
        await fetchJSON("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name,
            description,
            author,
            template_ids: templateIds,
            asset_ids: assetIds,
          }),
        });
        form.reset();
        loadProjects();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  if (page === "templates") {
    const form = document.getElementById("template-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const name = formData.get("name");
      if (!name) return;
      const category = formData.get("category") || "";
      const description = formData.get("description") || "";
      const author = formData.get("author") || "";
      try {
        await fetchJSON("/api/templates", {
          method: "POST",
          body: JSON.stringify({ name, category, description, author }),
        });
        form.reset();
        loadTemplates();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  if (page === "settings") {
    const form = document.getElementById("settings-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const backgroundRefs = (formData.get("background_references") || "")
        .toString()
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const detailRefs = (formData.get("detail_references") || "")
        .toString()
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      try {
        await fetchJSON("/api/settings", {
          method: "POST",
          body: JSON.stringify({
            saved_api_key: formData.get("saved_api_key"),
            background_references: backgroundRefs,
            detail_references: detailRefs,
          }),
        });
        loadSettings();
      } catch (error) {
        alert(error.message);
      }
    });

    const refreshButton = document.getElementById("refresh-status");
    refreshButton?.addEventListener("click", loadSettings);
  }
}

function hydrate(page) {
  setActiveNav(page);
  registerForms(page);
  if (page === "projects") {
    loadProjects();
  }
  if (page === "templates") {
    loadTemplates();
  }
  if (page === "assets") {
    const form = document.getElementById("asset-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const templateIds = parseIds(formData.get("template_ids"));
      const projectIds = parseIds(formData.get("project_ids"));
      formData.set("template_ids", templateIds.join(","));
      formData.set("project_ids", projectIds.join(","));
      try {
        await fetchJSON("/api/assets", {
          method: "POST",
          body: formData,
        });
        form.reset();
        loadAssets();
      } catch (error) {
        alert(error.message);
      }
    });
    loadAssets();
  }
  if (page === "settings") {
    loadSettings();
  }
}

function setupLanguageSwitcher() {
  const form = document.getElementById("language-switcher");
  if (!form) return;
  form.addEventListener("change", async (event) => {
    event.preventDefault();
    const select = form.querySelector("select[name='lang']");
    const lang = select?.value;
    if (!lang) return;
    try {
      await fetchJSON("/api/language", { method: "POST", body: JSON.stringify({ lang }) });
      window.location.reload();
    } catch (error) {
      console.error(error);
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  setupLanguageSwitcher();
  hydrate(page);
});
