import { RundownEditor } from "../../../components/RundownEditor";

export default async function RundownPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RundownEditor rundownId={id} />;
}
