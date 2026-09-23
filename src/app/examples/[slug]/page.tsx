import { PreviewGuide } from "@/components/guide-detail";
import styles from "@/components/guide-page.module.css";

export default async function ExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <div className={`${styles.page} page-section`}><div className="container"><PreviewGuide slug={slug}/></div></div>;
}
