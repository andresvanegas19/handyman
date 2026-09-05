"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="container empty-state page-section" role="alert"><h1>Something didn&apos;t quite work.</h1><p>Your connection or a service may be unavailable. Please try again.</p><button className="button" onClick={reset}>Try again</button></div>; }
