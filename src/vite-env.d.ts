/// <reference types="vite/client" />

interface Window {
  time2meetDiagnostics?: () => {
    configured: boolean;
    projectFingerprint: string;
  };
}
