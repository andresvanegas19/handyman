import { getFunctionName, type FunctionReference } from "convex/server";
import { recordCall, setFixture, useFixture } from "./store.fixture";

export function useQuery(query: FunctionReference<"query">, args?: Record<string, unknown> | "skip") {
  const fixture = useFixture();
  if (args === "skip") return undefined;
  switch (getFunctionName(query)) {
    case "repairPipeline:get": return fixture.result;
    default: throw new Error(`Unexpected browser fixture query: ${getFunctionName(query)}`);
  }
}

export function useMutation(mutation: FunctionReference<"mutation">) {
  return async (args: Record<string, unknown>) => {
    const name = getFunctionName(mutation);
    recordCall(name, args);
    switch (name) {
      case "repairPipeline:retry":
      case "repairPipeline:start":
        setFixture({ result: { phase: "recognizing", retryable: false, cacheHit: false } });
        return "run-fixture";
      case "repairPipeline:cancel":
        setFixture({ result: { phase: "cancelled", retryable: false, cacheHit: false } });
        return null;
      case "problems:remove": return null;
      case "repairPipeline:reportViewerFailure": return null;
      default: throw new Error(`Unexpected browser fixture mutation: ${name}`);
    }
  };
}

export function useConvexAuth() {
  const { token } = useFixture();
  return { isAuthenticated: Boolean(token), isLoading: false };
}
