import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured && supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
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
