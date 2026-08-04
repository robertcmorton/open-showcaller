import { GuestView } from "../../../components/GuestView";

export default async function GuestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuestView token={token} />;
}
