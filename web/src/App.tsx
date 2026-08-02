import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Skeleton } from '@/components/Skeleton';
import { usePersonaStore } from '@/state/persona';

const OrgOverview = lazy(() => import('@/pages/OrgOverview'));
const Insights = lazy(() => import('@/pages/Insights'));
const OrgSkills = lazy(() => import('@/pages/OrgSkills'));
const OrgMcp = lazy(() => import('@/pages/OrgMcp'));
const OrgActivity = lazy(() => import('@/pages/OrgActivity'));
const OrgHealth = lazy(() => import('@/pages/OrgHealth'));
const OrgCosts = lazy(() => import('@/pages/OrgCosts'));
const TeamsIndex = lazy(() => import('@/pages/TeamsIndex'));
const TeamPage = lazy(() => import('@/pages/TeamPage'));
const UserProfile = lazy(() => import('@/pages/UserProfile'));
const Leaderboard = lazy(() => import('@/pages/Leaderboard'));
const AdminTeams = lazy(() => import('@/pages/AdminTeams'));
const AdminSync = lazy(() => import('@/pages/AdminSync'));
const AdminSettings = lazy(() => import('@/pages/AdminSettings'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function PageFallback() {
  return (
    <div className="grid grid-cols-12 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="col-span-12 h-28 md:col-span-6 xl:col-span-4" />
      ))}
      <Skeleton className="col-span-12 h-72 lg:col-span-8" />
      <Skeleton className="col-span-12 h-72 lg:col-span-4" />
    </div>
  );
}

/** Redirect `/` by persona: developer → their profile, lead → their team, director → org. */
function HomeRedirect() {
  const { persona, email, teamId } = usePersonaStore();
  if (persona === 'developer' && email) {
    return <Navigate to={`/user/${encodeURIComponent(email)}`} replace />;
  }
  if (persona === 'lead' && teamId !== null) {
    return <Navigate to={`/team/${teamId}`} replace />;
  }
  return <Navigate to="/org" replace />;
}

const wrap = (node: React.ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>;

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/org" element={wrap(<OrgOverview />)} />
        <Route path="/org/insights" element={wrap(<Insights />)} />
        <Route path="/org/skills" element={wrap(<OrgSkills />)} />
        <Route path="/org/mcp" element={wrap(<OrgMcp />)} />
        <Route path="/org/activity" element={wrap(<OrgActivity />)} />
        <Route path="/org/health" element={wrap(<OrgHealth />)} />
        <Route path="/org/costs" element={wrap(<OrgCosts />)} />
        <Route path="/teams" element={wrap(<TeamsIndex />)} />
        <Route path="/team/:teamId" element={wrap(<TeamPage />)} />
        <Route path="/user/:email" element={wrap(<UserProfile />)} />
        <Route path="/leaderboard" element={wrap(<Leaderboard />)} />
        <Route path="/admin/teams" element={wrap(<AdminTeams />)} />
        <Route path="/admin/sync" element={wrap(<AdminSync />)} />
        <Route path="/admin/settings" element={wrap(<AdminSettings />)} />
        <Route path="*" element={wrap(<NotFound />)} />
      </Route>
    </Routes>
  );
}
