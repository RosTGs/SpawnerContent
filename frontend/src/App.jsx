import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";
import AssetsPage from "./pages/AssetsPage.jsx";
import AuthPage from "./pages/AuthPage.jsx";
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
  const { user, logout, isAuthenticated } = useAuth();
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
        <div className="user-box">
          {isAuthenticated ? (
            <>
              <div className="avatar" aria-hidden>
                {user?.username?.slice(0, 2)?.toUpperCase() || "US"}
              </div>
              <div className="username">{user?.username || "Пользователь"}</div>
              <button className="ghost" type="button" onClick={logout}>
                Выйти
              </button>
            </>
          ) : (
            <NavLink to="/auth" className="nav-link">
              Войти
            </NavLink>
          )}
        </div>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <TestDiagnosticsLauncher />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, initializing } = useAuth();

  if (initializing) {
    return <div className="page">Загрузка...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/main" replace />} />
        <Route
          path="/main"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route path="/generate" element={<Navigate to="/project" replace />} />
        <Route
          path="/project"
          element={
            <ProtectedRoute>
              <ProjectsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/project/:id/generate"
          element={
            <ProtectedRoute>
              <GeneratePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/templates"
          element={
            <ProtectedRoute>
              <TemplatesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/assets"
          element={
            <ProtectedRoute>
              <AssetsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );
}

export default App;
