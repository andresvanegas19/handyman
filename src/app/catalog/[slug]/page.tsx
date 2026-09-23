import GuideDetail from "@/components/guide-detail";
import styles from "@/components/guide-page.module.css";
export default async function GuidePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ versionId?: string }> }) {
  const [{slug},{versionId}] = await Promise.all([params,searchParams]);
  return <div className={`${styles.page} page-section`}><div className="container"><GuideDetail slug={slug} versionId={versionId}/></div></div>;
}
