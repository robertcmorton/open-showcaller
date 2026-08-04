import { PrompterView } from "../../../components/PrompterView";

export default async function PrompterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrompterView rundownId={id} />;
}
