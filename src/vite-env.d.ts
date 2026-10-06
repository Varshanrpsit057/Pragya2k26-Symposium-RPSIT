interface ImportMetaEnv {
  /**
   * Address of the registration server, set at build time only when the website and the
   * server are on different addresses (e.g. https://pragya-api.example.com/api/register).
   * Without it the form posts to /api/register on the same site.
   */
  readonly VITE_REGISTRATION_API_URL?: string;
}
