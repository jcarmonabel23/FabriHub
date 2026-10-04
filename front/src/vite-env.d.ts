/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_ENCRIP_KEY?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
