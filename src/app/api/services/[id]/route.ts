import { serviceInputSchema } from "@/lib/exam-schemas";
import {
  createRequestSupabaseClient,
  getSupabaseConfig,
} from "@/lib/supabase-server";

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
  if (authError && authError.status !== 401 && authError.status !== 403) {
    console.error("Service update authentication check failed");
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
    console.error("Service update profile lookup failed", profileError.code);
    return Response.json({ error: "Unable to verify provider access." }, { status: 500 });
  }
  if (profile?.role !== "provider") {
    return Response.json({ error: "Only providers can edit services." }, { status: 403 });
  }

  const { category_ids: categoryIds, ...serviceFields } = parsed.data;
  // The shared creation schema defaults this field to [], but omission during
  // an update must leave the service's existing relationships untouched.
  const updateCategories =
    typeof body === "object" && body !== null && Object.hasOwn(body, "category_ids");
  const desiredCategoryIds = [...new Set(categoryIds.map((id) => id.toLowerCase()))];

  if (updateCategories && desiredCategoryIds.length > 0) {
    const { data: categories, error: categoryError } = await supabase
      .from("service_categories")
      .select("id")
      .in("id", desiredCategoryIds)
      .eq("active_status", true);
    if (categoryError) {
      console.error("Service update category lookup failed", categoryError.code);
      return Response.json({ error: "Unable to verify service categories." }, { status: 500 });
    }
    const activeIds = new Set((categories ?? []).map((category) => category.id));
    if (desiredCategoryIds.some((categoryId) => !activeIds.has(categoryId))) {
      return Response.json(
        { error: "Every category must exist and be active." },
        { status: 400 },
      );
    }
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from("services")
    .update(serviceFields)
    .eq("id", id)
    .eq("provider_id", user.id)
    .in("status", ["draft", "suspended"])
    .select(
      "id, title, hourly_rate, duration_minutes, coverage_radius_miles, status",
    )
    .maybeSingle();

  if (error) {
    console.error("Service update failed", error.code);
    return Response.json(
      { error: "Unable to update the service." },
      { status: 500 },
    );
  }
  if (!data) {
    return Response.json(
      { error: "Only your draft or suspended services can be edited." },
      { status: 404 },
    );
  }

  if (updateCategories) {
    // Only reach the mapping writes after the ownership/status-filtered update
    // succeeds. Mapping-table RLS also enforces ownership and editable status.
    const { data: mappings, error: mappingReadError } = await supabase
      .from("service_category_mappings")
      .select("category_id")
      .eq("service_id", id);
    if (mappingReadError) {
      console.error("Service update category mapping lookup failed", mappingReadError.code);
      return Response.json(
        { error: "Service fields were updated, but existing categories could not be retrieved." },
        { status: 500 },
      );
    }

    const existingIds = new Set<string>((mappings ?? []).map((mapping) => mapping.category_id));
    const desiredIds = new Set(desiredCategoryIds);
    const addedIds = desiredCategoryIds.filter((categoryId) => !existingIds.has(categoryId));
    const removedIds = [...existingIds].filter((categoryId) => !desiredIds.has(categoryId));

    function mappingFailure(code: string) {
      console.error("Service update category assignment failed", code);
      const status = code === "42501" ? 403
        : code === "23503" || code === "23514" ? 400
        : code === "23505" ? 409 : 500;
      return Response.json(
        { error: "Service fields were updated, but category changes could not be completed. Reload the service before retrying." },
        { status },
      );
    }

    // Add first: a failed insert must not erase the original relationships.
    // These separate requests are not a transaction; report partial failures.
    if (addedIds.length > 0) {
      const { error: insertError } = await supabase
        .from("service_category_mappings")
        .insert(addedIds.map((category_id) => ({ service_id: id, category_id })));
      if (insertError) return mappingFailure(insertError.code);
    }
    if (removedIds.length > 0) {
      const { data: deletedMappings, error: deleteError } = await supabase
        .from("service_category_mappings")
        .delete()
        .eq("service_id", id)
        .in("category_id", removedIds)
        .select("category_id");
      if (deleteError) return mappingFailure(deleteError.code);
      // RLS can silently filter deletes if ownership/status changed meanwhile.
      if (deletedMappings?.length !== removedIds.length) {
        return Response.json(
          { error: "Service fields were updated, but category relationships changed or are no longer editable. Reload the service before retrying." },
          { status: 409 },
        );
      }
    }
  }

  return Response.json({ service: data });
}

export async function DELETE(
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
    console.error("Service delete authentication check failed");
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
    console.error("Service delete profile lookup failed", profileError.code);
    return Response.json({ error: "Unable to verify provider access." }, { status: 500 });
  }
  if (profile?.role !== "provider") {
    return Response.json({ error: "Only providers can delete services." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("services")
    .delete()
    .eq("id", id)
    .eq("provider_id", user.id)
    .in("status", ["draft", "suspended"])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Service delete failed", error.code);
    return Response.json({ error: "Unable to delete the service." }, { status: 500 });
  }
  if (!data) {
    return Response.json(
      { error: "Only your draft or suspended services can be deleted." },
      { status: 404 },
    );
  }

  return Response.json({ deleted: true });
}
