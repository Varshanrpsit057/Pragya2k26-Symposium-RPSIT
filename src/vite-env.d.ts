interface ImportMetaEnv {
  /**
   * Address of the registration API (e.g. https://abc123.execute-api.ap-south-1.amazonaws.com),
   * filled in at build time from amplify_outputs.json or the VITE_API_URL variable (see
   * vite.config.ts). Empty: the site calls /api on its own address. Public, never a secret.
   */
  readonly VITE_API_URL: string;
}
