export default function useCurrentUser() {
  return {
    id: "anonymous",
    name: "Anonymous",
    avatarUrl: "",
    email: "",
    isAdmin: false,
    language: "en_US",
  } as any;
}
