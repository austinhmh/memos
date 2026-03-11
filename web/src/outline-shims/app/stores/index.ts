const stores = {
  ui: {
    theme: "light",
    language: "en_US",
    sidebarCollapsed: false,
    tocVisible: false,
    toggleDarkMode: () => {},
  },
  auth: {
    user: null,
    team: null,
    currentUserId: null,
  },
  documents: {
    get: () => null,
    getByUrl: () => null,
    fetch: () => Promise.resolve(null),
    orderedData: [],
    searchTitles: () => [],
  },
  collections: {
    get: () => null,
    fetch: () => Promise.resolve(null),
    orderedData: [],
  },
  users: {
    get: () => null,
    orderedData: [],
  },
  groups: {
    orderedData: [],
  },
  integrations: {
    orderedData: [],
  },
  emojis: {
    orderedData: [],
    fetchPage: () => Promise.resolve(),
  },
  policies: {
    abilities: () => ({}),
  },
} as any;

export default stores;
