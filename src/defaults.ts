export const DEFAULT_TAVERN_PORT =
  import.meta.env.DEV || import.meta.env.TAURI_ENV_DEBUG === "true"
    ? 25272
    : 25252;
