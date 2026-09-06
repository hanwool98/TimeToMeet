const maintenanceBypassKey = 'time2meet.maintenanceBypass';

export const isMaintenanceActive = true;

export function hasMaintenanceBypass() {
  try {
    return window.sessionStorage.getItem(maintenanceBypassKey) === 'true';
  } catch {
    return false;
  }
}

export function enableMaintenanceBypass() {
  try {
    window.sessionStorage.setItem(maintenanceBypassKey, 'true');
  } catch {
    // The current page can still be opened when session storage is unavailable.
  }
}
