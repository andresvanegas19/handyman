import GuideDetail from "@/components/guide-detail";
export default async function GuidePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ versionId?: string }> }) {
  const [{slug},{versionId}] = await Promise.all([params,searchParams]);
  return <div className="container page-section"><GuideDetail slug={slug} versionId={versionId}/></div>;
}
