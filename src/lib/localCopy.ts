/**
 * A copy of the site running on this computer (npm run dev, a local mock API) looks exactly like the
 * live site but has its own accounts and data: pages say so, so nobody mixes them up.
 */
export const isLocalCopy = () =>
  import.meta.env.MODE !== 'test' && (import.meta.env.DEV || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname));
