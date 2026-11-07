import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";

const serviceInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(5000),
  price_amount: z.number().finite().min(0).max(99_999_999.99),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
});

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

async function createRequestSupabaseClient(
  config: NonNullable<ReturnType<typeof getSupabaseConfig>>,
) {
  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

export async function GET() {
  const config = getSupabaseConfig();
  if (!config) {
    return Response.json(
      { error: "Services are temporarily unavailable." },
      { status: 503 },
    );
  }

  const supabase = await createRequestSupabaseClient(config);
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, description, price_amount, currency, created_at, service_category_mappings(category:service_categories(id, name, slug))",
    )
    .eq("status", "approved")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Services GET query failed", error.code);
    return Response.json(
      { error: "Unable to retrieve services." },
      { status: 500 },
    );
  }

  return Response.json({ services: data });
}

export async function POST(request: Request) {
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

  const parsed = serviceInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid service information.",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
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

    console.error("Services POST authentication check failed");
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
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Services POST profile lookup failed", profileError.code);
    return Response.json(
      { error: "Unable to verify the service provider profile." },
      { status: 500 },
    );
  }

  if (!profile) {
    return Response.json(
      { error: "Create a profile before creating a service." },
      { status: 409 },
    );
  }

  const { data: service, error: insertError } = await supabase
    .from("services")
    .insert({
      ...parsed.data,
      provider_id: user.id,
    })
    .select("id, name, description, price_amount, currency, status, created_at")
    .single();

  if (insertError) {
    console.error("Services POST insert failed", insertError.code);

    if (insertError.code === "42501") {
      return Response.json(
        { error: "You are not authorized to create this service." },
        { status: 403 },
      );
    }

    if (insertError.code === "23503" || insertError.code === "23505") {
      return Response.json(
        { error: "The service conflicts with existing account or service data." },
        { status: 409 },
      );
    }

    if (insertError.code === "23514") {
      return Response.json(
        { error: "Service information does not meet database constraints." },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "Unable to create the service." },
      { status: 500 },
    );
  }

  return Response.json({ service }, { status: 201 });
}
