import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { DataLoadingState } from './DataState';
import { verifyAdminSession } from '../services/adminAuth';

type AdminRouteState = 'checking' | 'allowed' | 'denied';

export default function AdminRoute() {
  const [state, setState] = useState<AdminRouteState>('checking');

  useEffect(() => {
    let active = true;

    const check = async () => {
      const allowed = await verifyAdminSession();
      if (active) setState(allowed ? 'allowed' : 'denied');
    };

    void check();

    return () => {
      active = false;
    };
  }, []);

  if (state === 'checking') return <DataLoadingState />;
  if (state === 'denied') return <Navigate replace to="/" />;

  return <Outlet />;
}
