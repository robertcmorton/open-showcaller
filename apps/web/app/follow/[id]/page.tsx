import { FollowerView } from "../../../components/FollowerView";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { id } = await params;
  const { code } = await searchParams;
  return <FollowerView rundownId={id} joinCode={code} />;
}
