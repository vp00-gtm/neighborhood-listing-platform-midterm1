import { z } from "zod";
import {
  createRequestSupabaseClient,
  getSupabaseConfig,
} from "@/lib/supabase-server";

const reviewSchema = z.strictObject({
  status: z.enum(["approved", "suspended"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const config = getSupabaseConfig();
  if (!config) {
    return Response.json(
      { error: "Services are temporarily unavailable." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return Response.json(
        { error: "Request body must contain valid JSON." },
        { status: 400 },
      );
    }
    throw error;
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Review status must be approved or suspended." },
      { status: 400 },
    );
  }

  const supabase = await createRequestSupabaseClient(config);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError && authError.status !== 401 && authError.status !== 403) {
    console.error("Service review authentication check failed");
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
    console.error("Service review profile lookup failed", profileError.code);
    return Response.json({ error: "Unable to verify administrator access." }, { status: 500 });
  }
  if (profile?.role !== "admin") {
    return Response.json({ error: "Only administrators can review services." }, { status: 403 });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from("services")
    .update({ status: parsed.data.status })
    .eq("id", id)
    .in("status", parsed.data.status === "approved" ? ["pending"] : ["pending", "approved"])
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("Service review update failed", error.code);
    return Response.json({ error: "Unable to review the service." }, { status: 500 });
  }
  if (!data) {
    return Response.json(
      {
        error:
          parsed.data.status === "approved"
            ? "Only pending services can be approved."
            : "Only pending or approved services can be suspended.",
      },
      { status: 409 },
    );
  }

  return Response.json({ service: data });
}
