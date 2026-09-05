import { useFixture } from "./store.fixture";

export function useAuthToken() { return useFixture().token; }
