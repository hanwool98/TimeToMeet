import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured && supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;

export function getSupabaseDiagnostics() {
  const host = supabaseUrl ? new URL(supabaseUrl).host : '';
  return {
    configured: isSupabaseConfigured,
    projectFingerprint: host ? maskHost(host) : 'not-configured',
  };
}

function maskHost(host: string) {
  const [projectRef] = host.split('.');
  if (!projectRef) return 'unknown';
  return `****${projectRef.slice(-4)}`;
}
