import { redirect } from "next/navigation";

export default async function LegacyRundownPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/show/${id}`);
}
