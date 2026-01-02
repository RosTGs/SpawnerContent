import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import AssetsPage from "./pages/AssetsPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import GeneratePage from "./pages/GeneratePage.jsx";
import ProjectsPage from "./pages/ProjectsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import TemplatesPage from "./pages/TemplatesPage.jsx";
import TestDiagnosticsLauncher from "./TestDiagnosticsLauncher.jsx";

const navLinks = [
  { to: "/main", label: "Главная" },
  { to: "/project", label: "Проекты" },
  { to: "/templates", label: "Шаблоны" },
  { to: "/assets", label: "Ассеты" },
  { to: "/settings", label: "Настройки" },
];

function AppLayout() {
  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="dot" aria-hidden>
            ●
          </span>
          <span className="title">Gemini Sheet</span>
        </div>
        <nav className="nav">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <TestDiagnosticsLauncher />
    </div>
  );
}

function App() {
  return (
    <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/main" replace />} />
          <Route path="/main" element={<DashboardPage />} />
          <Route path="/generate" element={<Navigate to="/project" replace />} />
          <Route path="/project" element={<ProjectsPage />} />
          <Route path="/project/:id/generate" element={<GeneratePage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
