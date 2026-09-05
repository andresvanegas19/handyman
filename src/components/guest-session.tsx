"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";

const GuestSession = createContext<{ error: string; retry: () => void } | null>(null);

export function GuestSessionProvider({ children }: { children: React.ReactNode }) {
  const { signIn: startAnonymousSession } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<ReturnType<typeof startAnonymousSession> | null>(null);

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    let active = true;
    const failed = () => {
      if (active) setError("Your private browser session could not start. Check the connection and guest-session backend configuration, then retry.");
    };
    const timeout = setTimeout(failed, 30_000);
    request.current ??= startAnonymousSession("anonymous");
    request.current.then(result => {
      if (!result.signingIn) failed();
    }).catch(failed);
    return () => { active = false; clearTimeout(timeout); };
  }, [isLoading, isAuthenticated, startAnonymousSession, attempt]);

  const retry = () => { request.current = null; setError(""); setAttempt(value => value + 1); };
  return <GuestSession.Provider value={{ error, retry }}>{children}</GuestSession.Provider>;
}

export function GuestSessionStatus() {
  const session = useContext(GuestSession);
  if (!session) throw new Error("Guest session provider is missing.");
  return session.error
    ? <div className="empty-state"><p role="alert">{session.error}</p><button className="button" onClick={session.retry}>Retry connection</button></div>
    : <div className="empty-state" role="status"><p>Preparing your private browser session...</p><p className="small">No account or sign-in needed.</p></div>;
}
