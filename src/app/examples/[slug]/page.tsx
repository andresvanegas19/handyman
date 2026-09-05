import { PreviewGuide } from "@/components/guide-detail";

export default async function ExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <div className="container page-section"><PreviewGuide slug={slug}/></div>;
}
