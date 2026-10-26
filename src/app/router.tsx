import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { AppShell } from './AppShell';
import { StarField } from './StarField';
import { Wordmark } from './Wordmark';
import { LoadingState } from '@/components/ui/Primitives';
import { LoginPage } from '@/features/auth/LoginPage';
import { OnboardingPage } from '@/features/onboarding/OnboardingPage';
import { HomePage } from '@/features/home/HomePage';
import { TimelinePage } from '@/features/timeline/TimelinePage';
import { MemoryFormPage } from '@/features/memories/MemoryFormPage';
import { MemoryDetailPage } from '@/features/memories/MemoryDetailPage';
import { StarsPage } from '@/features/stars/StarsPage';
import { GalleryPage } from '@/features/gallery/GalleryPage';
import { CapsulesPage } from '@/features/capsules/CapsulesPage';
import { AskPage } from '@/features/ask/AskPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { NotFoundInline, NotFoundPage } from '@/features/layout/NotFoundPage';

function Splash() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-6">
      <StarField intensity={1.1} />
      <div className="relative z-10 flex flex-col items-center gap-5">
        <Wordmark />
        <span className="size-4 animate-spin rounded-full border-[1.5px] border-violet/70 border-t-transparent" />
        <p className="text-[11px] tracking-[0.16em] text-dim">正在进入你们的星球…</p>
      </div>
    </div>
  );
}

function RequireAuth() {
  const { state, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (state.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

function SpaceGate({ children }: { children: React.ReactNode }) {
  const { session, state } = useAuth();
  if (state.status === 'authenticated' && session === null) return <LoadingState label="正在读取空间…" />;
  if (!session?.space) return <OnboardingPage />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/app',
        element: <AppShell />,
        children: [
          { index: true, element: <SpaceGate><HomePage /></SpaceGate> },
          { path: 'timeline', element: <SpaceGate><TimelinePage /></SpaceGate> },
          { path: 'memories/new', element: <SpaceGate><MemoryFormPage mode="create" /></SpaceGate> },
          { path: 'memories/:id', element: <SpaceGate><MemoryDetailPage /></SpaceGate> },
          { path: 'memories/:id/edit', element: <SpaceGate><MemoryFormPage mode="edit" /></SpaceGate> },
          { path: 'stars', element: <SpaceGate><StarsPage /></SpaceGate> },
          { path: 'gallery', element: <SpaceGate><GalleryPage /></SpaceGate> },
          { path: 'capsules', element: <SpaceGate><CapsulesPage /></SpaceGate> },
          { path: 'ask', element: <SpaceGate><AskPage /></SpaceGate> },
          { path: 'settings', element: <SpaceGate><SettingsPage /></SpaceGate> },
          { path: '*', element: <SpaceGate><NotFoundInline /></SpaceGate> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
