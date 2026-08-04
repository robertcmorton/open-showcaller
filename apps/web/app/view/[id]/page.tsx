import { RundownEditor } from "../../../components/RundownEditor";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { id } = await params;
  const { code } = await searchParams;
  return <RundownEditor rundownId={id} mode="view" joinCode={code} />;
}
