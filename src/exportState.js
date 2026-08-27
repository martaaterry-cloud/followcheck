const EXPORT_REQUESTED_KEY = 'fc_export_requested_at';
const LAST_IMPORT_KEY = 'fc_last_successful_import_at';

export function loadExportState() {
  const exportRequestedAt = localStorage.getItem(EXPORT_REQUESTED_KEY) || null;
  const lastSuccessfulImportAt = localStorage.getItem(LAST_IMPORT_KEY) || null;

  return {
    exportRequestedAt,
    lastSuccessfulImportAt,
    isPending: isExportPending(exportRequestedAt, lastSuccessfulImportAt)
  };
}

export function recordExportRequested(timestamp = new Date().toISOString()) {
  localStorage.setItem(EXPORT_REQUESTED_KEY, timestamp);
  return timestamp;
}

export function recordSuccessfulImport(timestamp = new Date().toISOString()) {
  localStorage.setItem(LAST_IMPORT_KEY, timestamp);
  return timestamp;
}

export function isExportPending(exportRequestedAt, lastSuccessfulImportAt) {
  if (!exportRequestedAt) return false;
  if (!lastSuccessfulImportAt) return true;

  const reqTime = new Date(exportRequestedAt).getTime();
  const impTime = new Date(lastSuccessfulImportAt).getTime();

  if (isNaN(reqTime)) return false;
  if (isNaN(impTime)) return true;

  return reqTime > impTime;
}
