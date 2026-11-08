import {
  createRequestSupabaseClient,
  getSupabaseConfig,
} from "@/lib/supabase-server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const config = getSupabaseConfig();
  if (!config) {
    return Response.json(
      { error: "Services are temporarily unavailable." },
      { status: 503 },
    );
  }

  const { id } = await params;
  const supabase = await createRequestSupabaseClient(config);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError && authError.status !== 401 && authError.status !== 403) {
    console.error("Service submission authentication check failed");
    return Response.json(
      { error: "Authentication is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!user) {
    return Response.json({ error: "Authentication is required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Service submission profile lookup failed", profileError.code);
    return Response.json({ error: "Unable to verify provider access." }, { status: 500 });
  }
  if (profile?.role !== "provider") {
    return Response.json({ error: "Only providers can submit services." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("services")
    .update({ status: "pending" })
    .eq("id", id)
    .eq("provider_id", user.id)
    .eq("status", "draft")
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("Service submission update failed", error.code);
    return Response.json(
      { error: "Unable to submit the service for review." },
      { status: 500 },
    );
  }
  if (!data) {
    return Response.json(
      { error: "Only your draft services can be submitted for review." },
      { status: 409 },
    );
  }

  return Response.json({ service: data });
}
