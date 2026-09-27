import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Login, Signup } from "./pages/Auth";
import { AcceptInvite } from "./pages/Invite";
import { Home } from "./pages/Home";
import { WorkspaceLayout } from "./components/WorkspaceLayout";
import { CalendarPage } from "./pages/Calendar";
import { ListsPage } from "./pages/Lists";
import { GroceriesPage } from "./pages/Groceries";
import { PlanPage } from "./pages/Plan";
import { GoalsPage } from "./pages/Goals";
import { PhotosPage, PhotoReview } from "./pages/Photos";
import { SettingsPage } from "./pages/Settings";
import { Wall } from "./pages/Wall";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/wall/:token" element={<Wall />} />
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
      <Route path="/w/:workspaceId" element={<RequireAuth><WorkspaceLayout /></RequireAuth>}>
        <Route index element={<Navigate to="calendar" replace />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="events/:eventId" element={<CalendarPage />} />
        <Route path="lists" element={<ListsPage />} />
        <Route path="groceries" element={<GroceriesPage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="photos" element={<PhotosPage />} />
        <Route path="photos/:photoId" element={<PhotoReview />} />
        <Route path="settings" element={<Navigate to="calendars" replace />} />
        <Route path="settings/:tab" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
