import {
  createRequestSupabaseClient,
  getSupabaseConfig,
} from "@/lib/supabase-server";

export async function GET() {
  const config = getSupabaseConfig();
  if (!config) {
    return Response.json(
      { error: "Categories are temporarily unavailable." },
      { status: 503 },
    );
  }

  const supabase = await createRequestSupabaseClient(config);
  const { data, error } = await supabase
    .from("service_categories")
    .select("id, name, slug, active_status")
    .eq("active_status", true)
    .order("name");

  if (error) {
    console.error("Service categories GET query failed", error.code);
    return Response.json(
      { error: "Unable to retrieve active categories." },
      { status: 500 },
    );
  }

  return Response.json({ categories: data });
}
