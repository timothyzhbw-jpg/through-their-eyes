/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API service (SPEC 2), e.g. https://tte-api.<env>.azurecontainerapps.io.
   * Unset: the app plays the bundled data in public/data. */
  readonly VITE_API_URL?: string;
}
