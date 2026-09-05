export function usePathname() { return "/problems/visual-fixture"; }
export function useSearchParams() { return new URLSearchParams(window.location.search); }
export function useRouter() {
  return {
    push: (href: string) => window.history.pushState(null, "", href),
    replace: (href: string) => window.history.replaceState(null, "", href),
  };
}
