import path from 'path';

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  // Legacy: absolute fallback path (discouraged). Prefer storageRoot.
  defaultWorkspacePath: process.env.HOWTO_WORKSPACE_DEFAULT,
  // Root for per-account/workspace storage. Defaults to repo-local storage folder.
  storageRoot: process.env.HOWTO_STORAGE_ROOT || path.resolve(__dirname, '..', 'storage'),
};
