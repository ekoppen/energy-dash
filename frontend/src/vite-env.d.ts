/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_APENKAAS_URL: string;
  readonly VITE_APENKAAS_TENANT_ID: string;
  readonly VITE_APENKAAS_INSTELLINGEN_COLLECTION_ID: string;
  readonly VITE_APENKAAS_UURDATA_BUCKET_ID: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
