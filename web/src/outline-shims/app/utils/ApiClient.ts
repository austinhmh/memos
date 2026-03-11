export const client = {
  post: async (path: string, data?: any) => {
    console.warn("[shim] ApiClient.post called:", path);
    return {};
  },
  get: async (path: string) => {
    console.warn("[shim] ApiClient.get called:", path);
    return {};
  },
  fetch: async (path: string, options?: any) => {
    console.warn("[shim] ApiClient.fetch called:", path);
    return new Response();
  },
};

export default client;
