import { RotaApp } from "@rota/components/rota-app";

export default async function RestaurantRotaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <RotaApp slug={decodeURIComponent(slug)} />;
}
