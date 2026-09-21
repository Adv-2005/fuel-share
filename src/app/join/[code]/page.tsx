import { FuelShareApp } from "@/components/FuelShareApp";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <FuelShareApp inviteCode={code} />;
}
