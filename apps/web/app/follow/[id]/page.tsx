import { FollowerView } from "../../../components/FollowerView";

export default async function FollowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FollowerView rundownId={id} />;
}
