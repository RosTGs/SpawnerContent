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
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Запрос завершился с ошибкой");
  }
  return payload;
}

function renderProjects(projects) {
  const list = document.getElementById("projects-list");
  const counter = document.getElementById("project-counter");
  if (!list) return;
  list.innerHTML = "";
  counter.textContent = `${projects.length} шт.`;
  projects.forEach((project) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div class="stack" style="gap: 0.25rem">
          <strong>${project.name}</strong>
          <span class="muted">${project.description || "Без описания"}</span>
          <small class="muted">ID: ${project.id}</small>
        </div>
        <div class="stack" style="align-items: flex-end">
          <span class="badge">${project.status}</span>
          <span class="pill">Шаблонов: ${project.templates}</span>
          <span class="pill">Ассетов: ${project.assets}</span>
        </div>
      </div>`;
    list.appendChild(item);
  });
}

function renderTemplates(templates) {
  const list = document.getElementById("templates-list");
  const counter = document.getElementById("template-counter");
  if (!list) return;
  list.innerHTML = "";
  counter.textContent = `${templates.length} шт.`;
  templates.forEach((tpl) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div class="stack" style="gap: 0.25rem">
          <strong>${tpl.name}</strong>
          <span class="muted">${tpl.category || "Без категории"}</span>
        </div>
        <span class="pill">${tpl.used_by} проектов</span>
      </div>`;
    list.appendChild(item);
  });
}

function renderAssets(assets) {
  const list = document.getElementById("assets-list");
  const counter = document.getElementById("asset-counter");
  if (!list) return;
  list.innerHTML = "";
  counter.textContent = `${assets.length} шт.`;
  assets.forEach((asset) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div class="stack" style="gap: 0.25rem">
          <strong>${asset.filename}</strong>
          <span class="muted">${asset.kind}</span>
          <small class="muted">${asset.description || "Без описания"}</small>
        </div>
        <div class="stack" style="align-items: flex-end">
          <span class="pill">Размер: ${asset.size}</span>
          <span class="pill">Проекты: ${asset.project_count}</span>
        </div>
      </div>`;
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
    container.innerHTML = '<p class="muted">Нет данных</p>';
    return;
  }
  const total = document.createElement("p");
  total.textContent = `Всего генераций: ${status.progress.total}`;
  const completed = document.createElement("p");
  completed.textContent = `Готово: ${status.progress.completed}, активных: ${status.progress.active}`;
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
      try {
        await fetchJSON("/api/projects", {
          method: "POST",
          body: JSON.stringify({ name, description }),
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
      try {
        await fetchJSON("/api/templates", {
          method: "POST",
          body: JSON.stringify({ name, category }),
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
    loadAssets();
  }
  if (page === "settings") {
    loadSettings();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  hydrate(page);
});
