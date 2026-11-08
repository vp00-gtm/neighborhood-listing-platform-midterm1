import { bookingInputSchema } from "@/lib/exam-schemas";
import {
  createRequestSupabaseClient,
  getSupabaseConfig,
} from "@/lib/supabase-server";

export async function GET() {
  const config = getSupabaseConfig();
  if (!config) {
    return Response.json(
      { error: "Bookings are temporarily unavailable." },
      { status: 503 },
    );
  }

  const supabase = await createRequestSupabaseClient(config);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    if (authError.status === 401 || authError.status === 403) {
      return Response.json({ error: "Authentication is required." }, { status: 401 });
    }
    console.error("Bookings GET authentication check failed");
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
    console.error("Bookings GET profile lookup failed", profileError.code);
    return Response.json(
      { error: "Unable to verify booking access." },
      { status: 500 },
    );
  }
  if (profile?.role !== "admin" && profile?.role !== "provider") {
    return Response.json({ error: "You cannot access bookings." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("id, service_id, client_email, requested_date, notes, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Bookings GET query failed", error.code);
    return Response.json(
      { error: "Unable to retrieve bookings." },
      { status: 500 },
    );
  }

  return Response.json({ bookings: data });
}

export async function POST(request: Request) {
  const config = getSupabaseConfig();
  if (!config) {
    return Response.json(
      { error: "Bookings are temporarily unavailable." },
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

  const parsed = bookingInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid booking information.",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const supabase = await createRequestSupabaseClient(config);
  const { error } = await supabase.from("bookings").insert(parsed.data);

  if (error) {
    console.error("Bookings POST insert failed", error.code);
    if (error.code === "42501") {
      return Response.json(
        { error: "This service cannot accept booking requests." },
        { status: 403 },
      );
    }
    if (error.code === "23503" || error.code === "23514") {
      return Response.json(
        { error: "Booking information does not meet database requirements." },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Unable to submit the booking request." },
      { status: 500 },
    );
  }

  return Response.json(
    { message: "Your booking request was received." },
    { status: 201 },
  );
}
