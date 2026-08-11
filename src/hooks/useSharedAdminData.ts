import { useEffect, useState } from 'react';
import { syncSharedAdminState } from '../utils/adminApplications';
import { subscribeToSupabaseChanges } from '../services/supabaseApplications';

export default function useSharedAdminData() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;

    const sync = async () => {
      const changed = await syncSharedAdminState();
      if (active && changed) {
        setVersion((current) => current + 1);
      }
    };

    void sync();
    const unsubscribe = subscribeToSupabaseChanges(sync);
    const intervalId = window.setInterval(sync, 3000);

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, []);

  return version;
}
