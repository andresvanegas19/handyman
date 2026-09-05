import ProblemWorkspace from "@/components/problem-workspace";
export default async function ProblemPage({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <div className="container page-section"><ProblemWorkspace id={id}/></div>;}
