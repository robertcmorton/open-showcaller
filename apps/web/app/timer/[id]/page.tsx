import { TimerView } from "../../../components/TimerView";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { id } = await params;
  const { code } = await searchParams;
  return <TimerView rundownId={id} joinCode={code} />;
}
