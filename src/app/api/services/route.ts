import { serviceSchema } from "@/schemas/service";
import type { Service } from "@/types";
import {
  createRequestSupabaseClient,
  createSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabaseServer";

export async function GET() {
  try {
    // Public reads must not inherit provider-specific session visibility.
    // This explicit filter/column list is mandatory for the privileged client.
    const supabase = createSupabaseServerClient();
    if (!supabase) {
      return Response.json(
        { error: "Services are temporarily unavailable." },
        { status: 503 },
      );
    }

    const { data, error } = await supabase
      .from("services")
      .select(
        "id, title, description, hourly_rate, duration_minutes, coverage_radius_miles, created_at, service_category_mappings(category:service_categories(id, name, slug, active_status))",
      )
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      // The existing FK makes each mapping's category a nullable object.
      // No generated Supabase Database types are present in this project.
      .overrideTypes<Service[], { merge: false }>();

    if (error) {
      console.error("Services GET query failed", error.code);
      return Response.json(
        { error: "Unable to retrieve services." },
        { status: 500 },
      );
    }

    // The privileged client does not apply category RLS, so remove inactive
    // categories explicitly while keeping the frontend's nested response shape.
    const services = (data ?? []).map((service) => ({
      ...service,
      service_category_mappings: service.service_category_mappings.filter(
        (mapping) => mapping.category?.active_status === true,
      ),
    }));
    return Response.json({ services });
  } catch {
    console.error("Services GET failed unexpectedly");
    return Response.json(
      { error: "Unable to retrieve services." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    return await createService(request);
  } catch {
    console.error("Services POST failed unexpectedly");
    return Response.json({ error: "Unable to create the service." }, { status: 500 });
  }
}

async function createService(request: Request) {
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

  const parsed = serviceSchema.safeParse(body);
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

  const config = getSupabaseConfig();
  if (!config) {
    return Response.json(
      { error: "Services are temporarily unavailable." },
      { status: 503 },
    );
  }
  const requestSupabase = await createRequestSupabaseClient(config);
  const {
    data: { user },
    error: authError,
  } = await requestSupabase.auth.getUser();

  if (authError) {
    if (
      authError.name === "AuthSessionMissingError" ||
      authError.status === 401 || authError.status === 403
    ) {
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

  const { data: profile, error: profileError } = await requestSupabase
    .from("profiles")
    .select("role")
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

  if (profile.role !== "provider") {
    return Response.json(
      { error: "Only provider accounts can create services." },
      { status: 403 },
    );
  }

  const { category_ids: categoryIds, ...serviceFields } = parsed.data;
  // Keep every creation/category/cleanup operation in the verified provider's
  // session so the database's ownership and draft-only RLS checks also apply.
  const supabase = requestSupabase;

  const normalizedCategoryIds = [...new Set(categoryIds.map((id) => id.toLowerCase()))];
  if (normalizedCategoryIds.length > 0) {
    const { data: categories, error: categoryError } = await supabase
      .from("service_categories")
      .select("id")
      .in("id", normalizedCategoryIds)
      .eq("active_status", true);
    if (categoryError) {
      console.error("Services POST category lookup failed", categoryError.code);
      return Response.json({ error: "Unable to verify service categories." }, { status: 500 });
    }
    const activeIds = new Set((categories ?? []).map((category) => category.id));
    if (normalizedCategoryIds.some((id) => !activeIds.has(id))) {
      return Response.json({ error: "Every category must exist and be active." }, { status: 400 });
    }
  }

  const { data: service, error: insertError } = await supabase
    .from("services")
    .insert({
      ...serviceFields,
      provider_id: user.id,
      // The migration defaults to draft and intentionally grants providers no
      // INSERT privilege on status. The strict schema rejects browser status.
    })
    .select(
      "id, provider_id, title, hourly_rate, duration_minutes, coverage_radius_miles, status, created_at",
    )
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
  if (!service) {
    return Response.json({ error: "Unable to create the service." }, { status: 500 });
  }

  if (normalizedCategoryIds.length > 0) {
    const { error: mappingError } = await supabase
      .from("service_category_mappings")
      .insert(
        normalizedCategoryIds.map((category_id) => ({
          service_id: service.id,
          category_id,
        })),
      );
    if (mappingError) {
      console.error("Service category assignment failed", mappingError.code);
      const { error: cleanupError } = await supabase
        .from("services")
        .delete()
        .eq("id", service.id)
        .eq("provider_id", user.id)
        .eq("status", "draft");
      if (cleanupError) {
        console.error("Service draft cleanup after mapping failure failed", cleanupError.code);
      }
      return Response.json(
        {
          error: cleanupError
            ? "The draft was created, but categories could not be assigned or the draft removed."
            : "Categories could not be assigned; the service draft was removed.",
        },
        { status: 500 },
      );
    }
  }

  return Response.json({ service }, { status: 201 });
}
