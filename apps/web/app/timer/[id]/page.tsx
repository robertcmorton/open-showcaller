import { TimerView } from "../../../components/TimerView";

export default async function TimerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TimerView rundownId={id} />;
}
