import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const TABLES = {
  profiles: 'profiles',
  categories: 'service_categories',
  services: 'services',
  mappings: 'service_category_mappings',
  bookings: 'bookings',
};

const accountVariables = {
  providerA: ['PROVIDER_A_EMAIL', 'PROVIDER_A_PASSWORD'],
  providerB: ['PROVIDER_B_EMAIL', 'PROVIDER_B_PASSWORD'],
  clientA: ['CLIENT_A_EMAIL', 'CLIENT_A_PASSWORD'],
  clientB: ['CLIENT_B_EMAIL', 'CLIENT_B_PASSWORD'],
  unrelated: ['UNRELATED_EMAIL', 'UNRELATED_PASSWORD'],
};

const cases = [];
const sessions = {};
const results = [];
const temporaryServices = [];
const temporaryMappings = [];
const temporaryBookings = [];
const recordsRequiringAdminCleanup = [];
const allowMutations = process.env.RLS_ALLOW_MUTATING_TESTS === 'true';
const allowRiskyTests = process.env.RLS_ALLOW_RISKY_TESTS === 'true';
const allowPersistentBooking =
  process.env.RLS_ALLOW_PERSISTENT_BOOKING_TEST === 'true';

class BlockedTest extends Error {}

class TestFailure extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function assert(condition, message) {
  if (!condition) throw new TestFailure(message);
}

function classify(data, error) {
  if (error) {
    const rlsError =
      error.code === '42501' ||
      /row-level security|permission denied/i.test(error.message ?? '');
    return {
      kind: rlsError ? 'rls_rejection' : 'database_error',
      code: error.code ?? 'unknown',
    };
  }

  if (data == null || (Array.isArray(data) && data.length === 0)) {
    return { kind: 'zero_rows' };
  }

  return { kind: 'success' };
}

function failForResult(message, result) {
  const state = classify(result.data, result.error);
  throw new TestFailure(`${message} (${state.kind})`, state.code);
}

function expectRows(result, predicate, message) {
  const state = classify(result.data, result.error);
  if (state.kind !== 'success') failForResult(message, result);
  const rows = Array.isArray(result.data) ? result.data : [result.data];
  assert(rows.some(predicate), message);
  return rows;
}

function expectDenied(result, message) {
  const state = classify(result.data, result.error);
  if (state.kind !== 'rls_rejection' && state.kind !== 'zero_rows') {
    failForResult(message, result);
  }
}

function requireFlag(enabled, name) {
  if (!enabled) {
    throw new BlockedTest(
      `requires ${name}=true; use an isolated test project for write tests`,
    );
  }
}

function addCase(id, name, run) {
  cases.push({ id, name, run });
}

async function runCase(testCase) {
  try {
    await testCase.run();
    results.push({ id: testCase.id, name: testCase.name, status: 'Passed' });
  } catch (error) {
    results.push({
      id: testCase.id,
      name: testCase.name,
      status: error instanceof BlockedTest ? 'Blocked' : 'Failed',
      detail: error instanceof BlockedTest || error instanceof TestFailure
        ? `${error.message}${error.code ? `; database code ${error.code}` : ''}`
        : `unexpected error; database code ${error?.code ?? 'unavailable'}`,
    });
  }
}

function getClient(role) {
  const client = sessions[role]?.client;
  if (!client) throw new BlockedTest(`${role} session is unavailable`);
  return client;
}

function getUserId(role) {
  const id = sessions[role]?.userId;
  if (!id) throw new BlockedTest(`${role} identity is unavailable`);
  return id;
}

function requireRows(rows, description) {
  if (!rows.length) throw new BlockedTest(`no ${description} fixture is available`);
  return rows;
}

async function selectRows(client, table, columns, filters = []) {
  let query = client.from(table).select(columns);
  for (const [method, column, value] of filters) {
    query = query[method](column, value);
  }
  const result = await query;
  if (result.error) {
    const state = classify(result.data, result.error);
    throw new TestFailure(
      `${table} fixture query failed (${state.kind})`,
      state.code,
    );
  }
  return result.data ?? [];
}

async function readOwnServices(role) {
  return selectRows(getClient(role), TABLES.services, '*', [
    ['eq', 'provider_id', getUserId(role)],
  ]);
}

async function readOwnBookings(role) {
  return selectRows(getClient(role), TABLES.bookings, '*', [
    ['eq', 'client_id', getUserId(role)],
  ]);
}

async function readBooking(client, id) {
  const result = await client
    .from(TABLES.bookings)
    .select('id, client_id, service_id, scheduled_at, client_notes')
    .eq('id', id);
  if (result.error) {
    const state = classify(result.data, result.error);
    throw new TestFailure(`booking query failed (${state.kind})`, state.code);
  }
  return result.data ?? [];
}

async function createDraftService(role, suffix) {
  const client = getClient(role);
  const providerId = getUserId(role);
  const token = randomUUID();
  const result = await client
    .from(TABLES.services)
    .insert({
      provider_id: providerId,
      name: `RLS test ${suffix} ${token}`,
      description: `Temporary RLS test service ${token}`,
      price_amount: 1,
      currency: 'USD',
      status: 'draft',
    })
    .select('id, provider_id, name, description, status')
    .single();

  const state = classify(result.data, result.error);
  if (state.kind !== 'success' || result.data?.provider_id !== providerId) {
    failForResult(`could not create and verify ${role} draft service`, result);
  }

  const record = { owner: role, ...result.data };
  temporaryServices.push(record);
  return record;
}

async function cleanupTemporaryRecords() {
  const cleanupProblems = [];

  for (const mapping of [...temporaryMappings].reverse()) {
    const result = await getClient(mapping.owner)
      .from(TABLES.mappings)
      .delete()
      .eq('service_id', mapping.service_id)
      .eq('category_id', mapping.category_id)
      .select('service_id, category_id');
    const deleted = !result.error && result.data?.length === 1;
    if (!deleted) cleanupProblems.push(`mapping cleanup ${classify(result.data, result.error).kind}`);
  }

  for (const service of [...temporaryServices].reverse()) {
    const result = await getClient(service.owner)
      .from(TABLES.services)
      .delete()
      .eq('id', service.id)
      .eq('provider_id', getUserId(service.owner))
      .select('id');
    const deleted = !result.error && result.data?.length === 1;
    if (!deleted) cleanupProblems.push(`service cleanup ${classify(result.data, result.error).kind}`);
  }

  if (temporaryBookings.length) {
    cleanupProblems.push(
      `${temporaryBookings.length} explicitly opted-in booking test record(s) remain; the RLS rules do not permit client-side deletion`,
    );
  }

  return cleanupProblems;
}

const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const missingConfiguration = [];

if (!anonUrl) missingConfiguration.push('NEXT_PUBLIC_SUPABASE_URL');
if (!publishableKey) missingConfiguration.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
for (const [, [emailKey, passwordKey]] of Object.entries(accountVariables)) {
  if (!process.env[emailKey]) missingConfiguration.push(emailKey);
  if (!process.env[passwordKey]) missingConfiguration.push(passwordKey);
}

if (missingConfiguration.length === 0) {
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
  };
  sessions.anon = {
    client: createClient(anonUrl, publishableKey, options),
    userId: null,
  };

  for (const [role, [emailKey, passwordKey]] of Object.entries(accountVariables)) {
    const client = createClient(anonUrl, publishableKey, options);
    const { data, error } = await client.auth.signInWithPassword({
      email: process.env[emailKey],
      password: process.env[passwordKey],
    });

    if (error || !data.user?.id) {
      missingConfiguration.push(`${role} sign-in failed`);
      continue;
    }

    sessions[role] = { client, userId: data.user.id };
  }
}

addCase('1', 'Anonymous can read approved services', async () => {
  if (missingConfiguration.length) throw new BlockedTest('Supabase setup incomplete');
  const rows = await selectRows(getClient('anon'), TABLES.services, 'id, status', [
    ['eq', 'status', 'approved'],
  ]);
  requireRows(rows, 'approved service');
  assert(rows.every((row) => row.status === 'approved'), 'public query returned a non-approved service');
});

addCase('2', 'Anonymous cannot read draft or suspended services', async () => {
  const own = (await readOwnServices('providerA')).filter((row) =>
    ['draft', 'suspended'].includes(row.status),
  );
  requireRows(own, 'Provider A draft/suspended service');
  const result = await getClient('anon')
    .from(TABLES.services)
    .select('id')
    .in('id', own.map((row) => row.id));
  if (result.error) failForResult('anonymous service read failed', result);
  assert(result.data.length === 0, 'anonymous user could read a non-approved service');
});

addCase('3', 'Anonymous can read active categories and public mappings', async () => {
  const client = getClient('anon');
  const categories = await selectRows(client, TABLES.categories, 'id, is_active', [
    ['eq', 'is_active', true],
  ]);
  requireRows(categories, 'active category');
  const services = await selectRows(client, TABLES.services, 'id, status', [
    ['eq', 'status', 'approved'],
  ]);
  requireRows(services, 'approved service');
  const mappings = await selectRows(client, TABLES.mappings, 'service_id, category_id');
  const approvedIds = new Set(services.map((row) => row.id));
  const activeIds = new Set(categories.map((row) => row.id));
  assert(
    mappings.some(
      (row) => approvedIds.has(row.service_id) && activeIds.has(row.category_id),
    ),
    'no public mapping for an approved service and active category was returned',
  );
});

addCase('4', 'Anonymous cannot read inactive categories or unapproved mappings', async () => {
  const ownServices = (await readOwnServices('providerA')).filter((row) =>
    ['draft', 'suspended'].includes(row.status),
  );
  requireRows(ownServices, 'Provider A unapproved service');
  const ownMappings = await selectRows(
    getClient('providerA'),
    TABLES.mappings,
    'service_id, category_id',
    [['in', 'service_id', ownServices.map((row) => row.id)]],
  );
  requireRows(ownMappings, 'Provider A unapproved-service mapping');
  const hidden = await getClient('anon')
    .from(TABLES.mappings)
    .select('service_id, category_id')
    .in('service_id', ownServices.map((row) => row.id));
  if (hidden.error) failForResult('unapproved mapping read failed', hidden);
  assert(hidden.data.length === 0, 'anonymous user could read an unapproved-service mapping');

  const inactiveId = process.env.RLS_INACTIVE_CATEGORY_ID;
  if (!inactiveId) {
    throw new BlockedTest('set RLS_INACTIVE_CATEGORY_ID to a known inactive category');
  }
  const inactive = await getClient('anon')
    .from(TABLES.categories)
    .select('id')
    .eq('id', inactiveId);
  if (inactive.error) failForResult('inactive category read failed', inactive);
  assert(inactive.data.length === 0, 'anonymous user could read an inactive category');
});

addCase('5', 'Provider A can create a verified draft service for self', async () => {
  requireFlag(allowMutations, 'RLS_ALLOW_MUTATING_TESTS');
  await createDraftService('providerA', 'Provider A');
});

addCase('6', 'Provider A cannot create for Provider B or create approved/suspended services', async () => {
  requireFlag(allowMutations, 'RLS_ALLOW_MUTATING_TESTS');
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  await createDraftService('providerB', 'Provider B');
  const token = randomUUID();
  const attempts = [
    {
      role: 'providerA',
      provider_id: getUserId('providerB'),
      status: 'draft',
      name: `RLS cross-owner ${token}`,
    },
    {
      role: 'providerA',
      provider_id: getUserId('providerA'),
      status: 'suspended',
      name: `RLS suspended insert ${token}`,
    },
  ];

  for (const attempt of attempts) {
    const result = await getClient(attempt.role)
      .from(TABLES.services)
      .insert({
        provider_id: attempt.provider_id,
        status: attempt.status,
        name: attempt.name,
        description: `RLS negative test ${token}`,
        price_amount: 1,
        currency: 'USD',
      })
      .select('id, provider_id, status')
      .maybeSingle();
    const owner = attempt.provider_id === getUserId('providerB') ? 'providerB' : 'providerA';
    const persisted = await selectRows(getClient(owner), TABLES.services, 'id', [
      ['eq', 'name', attempt.name],
    ]);
    if (persisted.length > 0) {
      await getClient(owner)
        .from(TABLES.services)
        .delete()
        .in('id', persisted.map((row) => row.id));
      throw new TestFailure('unauthorized service insert persisted; cleanup attempted');
    }
    expectDenied(result, 'unauthorized service insert was not denied');
  }

  if (process.env.RLS_ALLOW_APPROVED_INSERT_TEST !== 'true') {
    throw new BlockedTest(
      'remaining approved-service insert check requires isolated test DB and RLS_ALLOW_APPROVED_INSERT_TEST=true',
    );
  }
  const approvedServiceInsert = await getClient('providerA')
    .from(TABLES.services)
    .insert({
      provider_id: getUserId('providerA'),
      name: `RLS approved insert ${token}`,
      description: `RLS negative test ${token}`,
      price_amount: 1,
      currency: 'USD',
      status: 'approved',
    })
    .select('id')
    .maybeSingle();
  if (approvedServiceInsert.data?.id) {
    recordsRequiringAdminCleanup.push('unauthorized approved service insert');
  }
  expectDenied(approvedServiceInsert, 'provider was able to create an approved service');
  const unexpectedApproved = await selectRows(
    getClient('providerA'),
    TABLES.services,
    'id',
    [['eq', 'name', `RLS approved insert ${token}`]],
  );
  assert(unexpectedApproved.length === 0, 'denied approved-service insert persisted a row');
});

addCase('7', 'Provider A can read/update own draft or suspended service', async () => {
  requireFlag(allowMutations, 'RLS_ALLOW_MUTATING_TESTS');
  const service =
    temporaryServices.find((row) => row.owner === 'providerA') ??
    requireRows(
      (await readOwnServices('providerA')).filter((row) =>
        ['draft', 'suspended'].includes(row.status),
      ),
      'Provider A draft/suspended service',
    )[0];
  const client = getClient('providerA');
  const read = await client
    .from(TABLES.services)
    .select('id, provider_id, name, status')
    .eq('id', service.id)
    .single();
  expectRows({ ...read, data: read.data ? [read.data] : [] }, (row) => row.id === service.id, 'provider could not read own service');

  const updatedName = `${service.name.slice(0, 70)} test ${randomUUID().slice(0, 8)}`;
  const update = await client
    .from(TABLES.services)
    .update({ name: updatedName })
    .eq('id', service.id)
    .select('id, name, status')
    .single();
  expectRows({ ...update, data: update.data ? [update.data] : [] }, (row) => row.name === updatedName && ['draft', 'suspended'].includes(row.status), 'provider update did not return the expected updated row');
  const restore = await client
    .from(TABLES.services)
    .update({ name: service.name })
    .eq('id', service.id)
    .select('id');
  expectRows(restore, (row) => row.id === service.id, 'could not restore service after update test');
});

addCase('8', 'Provider A cannot alter Provider B service, ownership, or approval status', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  const serviceA = temporaryServices.find((row) => row.owner === 'providerA');
  const serviceB = temporaryServices.find((row) => row.owner === 'providerB');
  if (!serviceA || !serviceB) {
    throw new BlockedTest('requires disposable draft services owned by both providers');
  }

  const attempt = await getClient('providerA')
    .from(TABLES.services)
    .update({ name: `unauthorized ${randomUUID()}` })
    .eq('id', serviceB.id)
    .select('id');
  const verifyB = await getClient('providerB')
    .from(TABLES.services)
    .select('id, name')
    .eq('id', serviceB.id)
    .single();
  expectRows({ ...verifyB, data: verifyB.data ? [verifyB.data] : [] }, (row) => row.name === serviceB.name, 'Provider B service changed');
  expectDenied(attempt, 'Provider A altered Provider B service');

  for (const change of [
    { provider_id: getUserId('providerB') },
    { status: 'approved' },
  ]) {
    const rejected = await getClient('providerA')
      .from(TABLES.services)
      .update(change)
      .eq('id', serviceA.id)
      .select('id, provider_id, status');
    const ownerARecord = await getClient('providerA')
      .from(TABLES.services)
      .select('id, provider_id, status')
      .eq('id', serviceA.id)
      .maybeSingle();
    const ownerBRecord = await getClient('providerB')
      .from(TABLES.services)
      .select('id, provider_id, status')
      .eq('id', serviceA.id)
      .maybeSingle();
    const actual = ownerARecord.data ?? ownerBRecord.data;
    if (
      !actual ||
      actual.provider_id !== getUserId('providerA') ||
      actual.status !== 'draft'
    ) {
      if (actual && actual.status !== 'approved') {
        await getClient(actual.provider_id === getUserId('providerB') ? 'providerB' : 'providerA')
          .from(TABLES.services)
          .update({ provider_id: getUserId('providerA'), status: 'draft' })
          .eq('id', serviceA.id);
      } else if (actual?.status === 'approved') {
        recordsRequiringAdminCleanup.push('unauthorized service approval');
      }
      throw new TestFailure('service changed after rejected ownership/status update; restoration attempted where allowed');
    }
    expectDenied(rejected, 'unauthorized ownership/status change was not denied');
  }
});

addCase('9', 'Provider A cannot update an approved service', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  const approved = requireRows(
    (await readOwnServices('providerA')).filter((row) => row.status === 'approved'),
    'Provider A approved service',
  )[0];
  const result = await getClient('providerA')
    .from(TABLES.services)
    .update({ name: `RLS approval guard ${randomUUID()}` })
    .eq('id', approved.id)
    .select('id');
  const unchanged = await getClient('providerA')
    .from(TABLES.services)
    .select('id, name')
    .eq('id', approved.id)
    .single();
  if (unchanged.data?.name !== approved.name) {
    await getClient('providerA')
      .from(TABLES.services)
      .update({ name: approved.name })
      .eq('id', approved.id);
    throw new TestFailure('approved service changed after rejected update; restoration attempted');
  }
  expectDenied(result, 'provider updated approved service');
});

addCase('10', 'Provider A cannot delete Provider B service', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  const serviceB = temporaryServices.find((row) => row.owner === 'providerB');
  if (!serviceB) throw new BlockedTest('requires disposable Provider B draft service');
  const result = await getClient('providerA')
    .from(TABLES.services)
    .delete()
    .eq('id', serviceB.id)
    .select('id');
  const unchanged = await getClient('providerB')
    .from(TABLES.services)
    .select('id, name')
    .eq('id', serviceB.id)
    .maybeSingle();
  if (unchanged.data?.id !== serviceB.id || unchanged.data.name !== serviceB.name) {
    const index = temporaryServices.findIndex((row) => row.id === serviceB.id);
    if (index >= 0) temporaryServices.splice(index, 1);
    throw new TestFailure('Provider B service was deleted or changed');
  }
  expectDenied(result, 'Provider A deleted Provider B service');
});

addCase('11', 'Provider A can add a mapping to own unapproved service', async () => {
  requireFlag(allowMutations, 'RLS_ALLOW_MUTATING_TESTS');
  const service =
    temporaryServices.find((row) => row.owner === 'providerA') ??
    requireRows(
      (await readOwnServices('providerA')).filter((row) =>
        ['draft', 'suspended'].includes(row.status),
      ),
      'Provider A unapproved service',
    )[0];
  const categories = await selectRows(
    getClient('providerA'),
    TABLES.categories,
    'id',
    [['eq', 'is_active', true]],
  );
  requireRows(categories, 'active category');
  let categoryId;
  for (const category of categories) {
    const existing = await selectRows(
      getClient('providerA'),
      TABLES.mappings,
      'service_id, category_id',
      [
        ['eq', 'service_id', service.id],
        ['eq', 'category_id', category.id],
      ],
    );
    if (!existing.length) {
      categoryId = category.id;
      break;
    }
  }
  if (!categoryId) throw new BlockedTest('no unused active category for the service');

  const result = await getClient('providerA')
    .from(TABLES.mappings)
    .insert({ service_id: service.id, category_id: categoryId })
    .select('service_id, category_id')
    .single();
  if (result.error || !result.data) {
    const persisted = await selectRows(
      getClient('providerA'),
      TABLES.mappings,
      'service_id, category_id',
      [
        ['eq', 'service_id', service.id],
        ['eq', 'category_id', categoryId],
      ],
    );
    if (persisted.length) {
      temporaryMappings.push({
        owner: 'providerA',
        service_id: service.id,
        category_id: categoryId,
      });
      throw new TestFailure(
        'mapping exists but INSERT RETURNING did not return it; check mapping SELECT policy',
        result.error?.code,
      );
    }
    failForResult('provider mapping insert did not return the expected row', result);
  }
  const inserted = expectRows(
    { ...result, data: [result.data] },
    (row) => row.service_id === service.id && row.category_id === categoryId,
    'provider mapping insert did not return the expected row',
  )[0];
  temporaryMappings.push({
    owner: 'providerA',
    service_id: inserted.service_id,
    category_id: inserted.category_id,
  });
  const anonRead = await getClient('anon')
    .from(TABLES.mappings)
    .select('service_id')
    .eq('service_id', service.id)
    .eq('category_id', categoryId);
  if (anonRead.error) failForResult('public draft mapping read failed', anonRead);
  assert(anonRead.data.length === 0, 'draft service mapping became public');
});

addCase('12', 'Provider A cannot map another provider, approved service, or inactive category', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  const providerBService = temporaryServices.find((row) => row.owner === 'providerB');
  if (!providerBService) throw new BlockedTest('requires disposable Provider B draft service');
  const categories = await selectRows(
    getClient('providerA'),
    TABLES.categories,
    'id',
    [['eq', 'is_active', true]],
  );
  const category = requireRows(categories, 'active category')[0];

  const result = await getClient('providerA')
    .from(TABLES.mappings)
    .insert({
      service_id: providerBService.id,
      category_id: category.id,
    })
    .select('service_id')
    .maybeSingle();
  if (result.data?.service_id) {
    temporaryMappings.push({
      owner: 'providerB',
      service_id: result.data.service_id,
      category_id: category.id,
    });
  }
  const mappingAfterDeniedInsert = await selectRows(
    getClient('providerB'),
    TABLES.mappings,
    'service_id',
    [
      ['eq', 'service_id', providerBService.id],
      ['eq', 'category_id', category.id],
    ],
  );
  if (mappingAfterDeniedInsert.length) {
    await getClient('providerB')
      .from(TABLES.mappings)
      .delete()
      .eq('service_id', providerBService.id)
      .eq('category_id', category.id);
    throw new TestFailure('cross-provider mapping insert persisted; cleanup attempted');
  }
  expectDenied(result, 'Provider A mapped Provider B service');

  if (process.env.RLS_ALLOW_APPROVED_MAPPING_TEST !== 'true') {
    throw new BlockedTest(
      'approved-service mapping check requires isolated test DB and RLS_ALLOW_APPROVED_MAPPING_TEST=true',
    );
  }
  const approvedService = requireRows(
    (await readOwnServices('providerA')).filter((row) => row.status === 'approved'),
    'Provider A approved service',
  )[0];
  const existingApprovedMappings = await selectRows(
    getClient('anon'),
    TABLES.mappings,
    'category_id',
    [['eq', 'service_id', approvedService.id]],
  );
  const existingApprovedCategoryIds = new Set(
    existingApprovedMappings.map((row) => row.category_id),
  );
  const unusedActiveCategory = categories.find(
    (candidate) => !existingApprovedCategoryIds.has(candidate.id),
  );
  if (!unusedActiveCategory) {
    throw new BlockedTest('no unused active category for the approved-service mapping check');
  }
  const approvedMapping = await getClient('providerA')
    .from(TABLES.mappings)
    .insert({
      service_id: approvedService.id,
      category_id: unusedActiveCategory.id,
    })
    .select('service_id')
    .maybeSingle();
  if (approvedMapping.data?.service_id) {
    temporaryMappings.push({
      owner: 'providerA',
      service_id: approvedMapping.data.service_id,
      category_id: unusedActiveCategory.id,
    });
    recordsRequiringAdminCleanup.push('unauthorized approved-service mapping insert');
  }
  expectDenied(approvedMapping, 'provider mapped an approved service');
  const approvedMappingAfter = await selectRows(
    getClient('providerA'),
    TABLES.mappings,
    'service_id',
    [
      ['eq', 'service_id', approvedService.id],
      ['eq', 'category_id', unusedActiveCategory.id],
    ],
  );
  assert(approvedMappingAfter.length === 0, 'denied approved-service mapping insert persisted');

  const inactiveId = process.env.RLS_INACTIVE_CATEGORY_ID;
  if (!inactiveId) {
    throw new BlockedTest('set RLS_INACTIVE_CATEGORY_ID for inactive-category insert check');
  }
  const ownService = temporaryServices.find((row) => row.owner === 'providerA');
  if (!ownService) throw new BlockedTest('requires disposable Provider A service');
  const inactive = await getClient('providerA')
    .from(TABLES.mappings)
    .insert({ service_id: ownService.id, category_id: inactiveId })
    .select('service_id')
    .maybeSingle();
  const inactiveMappingAfter = await selectRows(
    getClient('providerA'),
    TABLES.mappings,
    'service_id',
    [
      ['eq', 'service_id', ownService.id],
      ['eq', 'category_id', inactiveId],
    ],
  );
  if (inactiveMappingAfter.length) {
    temporaryMappings.push({
      owner: 'providerA',
      service_id: ownService.id,
      category_id: inactiveId,
    });
    throw new TestFailure('inactive-category mapping persisted; cleanup attempted later');
  }
  expectDenied(inactive, 'provider mapped an inactive category');
  assert(inactiveMappingAfter.length === 0, 'denied inactive-category mapping insert persisted');
});

addCase('13', 'Provider A cannot delete Provider B mapping', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  const serviceB = temporaryServices.find((row) => row.owner === 'providerB');
  if (!serviceB) throw new BlockedTest('requires disposable Provider B service');
  const categories = await selectRows(
    getClient('providerB'),
    TABLES.categories,
    'id',
    [['eq', 'is_active', true]],
  );
  const category = requireRows(categories, 'active category')[0];
  const existing = await selectRows(
    getClient('providerB'),
    TABLES.mappings,
    'service_id, category_id',
    [
      ['eq', 'service_id', serviceB.id],
      ['eq', 'category_id', category.id],
    ],
  );
  if (!existing.length) {
    const created = await getClient('providerB')
      .from(TABLES.mappings)
      .insert({ service_id: serviceB.id, category_id: category.id })
      .select('service_id')
      .single();
    expectRows({ ...created, data: created.data ? [created.data] : [] }, (row) => row.service_id === serviceB.id, 'could not create disposable Provider B mapping');
    temporaryMappings.push({
      owner: 'providerB',
      service_id: serviceB.id,
      category_id: category.id,
    });
  }
  const result = await getClient('providerA')
    .from(TABLES.mappings)
    .delete()
    .eq('service_id', serviceB.id)
    .eq('category_id', category.id)
    .select('service_id');
  const unchanged = await selectRows(
    getClient('providerB'),
    TABLES.mappings,
    'service_id, category_id',
    [
      ['eq', 'service_id', serviceB.id],
      ['eq', 'category_id', category.id],
    ],
  );
  if (unchanged.length !== 1) {
    const index = temporaryMappings.findIndex(
      (row) =>
        row.owner === 'providerB' &&
        row.service_id === serviceB.id &&
        row.category_id === category.id,
    );
    if (index >= 0) temporaryMappings.splice(index, 1);
    throw new TestFailure('Provider B mapping was removed');
  }
  expectDenied(result, 'Provider A deleted Provider B mapping');
});

addCase('14', 'Client A can create a booking for self on an approved service', async () => {
  requireFlag(allowPersistentBooking, 'RLS_ALLOW_PERSISTENT_BOOKING_TEST');
  const approved = (await readOwnServices('providerA')).filter(
    (service) => service.status === 'approved',
  );
  const service = requireRows(approved, 'approved service')[0];
  const notes = `RLS persistent booking test ${randomUUID()}`;
  const result = await getClient('clientA')
    .from(TABLES.bookings)
    .insert({
      client_id: getUserId('clientA'),
      service_id: service.id,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      client_notes: notes,
    })
    .select('id, client_id, service_id, client_notes')
    .single();
  const row = expectRows(
    { ...result, data: result.data ? [result.data] : [] },
    (booking) =>
      booking.client_id === getUserId('clientA') &&
      booking.service_id === service.id &&
      booking.client_notes === notes,
    'booking insert did not return the expected booking',
  )[0];
  temporaryBookings.push(row.id);
});

addCase('15', 'Client A cannot create for Client B or use a non-approved service', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  const ownServices = (await readOwnServices('providerA')).filter((row) =>
    ['draft', 'suspended'].includes(row.status),
  );
  const nonApproved = requireRows(ownServices, 'non-approved service')[0];
  const approvedService = requireRows(
    await selectRows(getClient('clientA'), TABLES.services, 'id', [
      ['eq', 'status', 'approved'],
    ]),
    'approved service',
  )[0];
  const attempts = [
    {
      client_id: getUserId('clientB'),
      service_id: approvedService.id,
      client_notes: `RLS invalid booking ${randomUUID()}`,
    },
    {
      client_id: getUserId('clientA'),
      service_id: nonApproved.id,
      client_notes: `RLS invalid booking ${randomUUID()}`,
    },
  ];
  for (const payload of attempts) {
    const result = await getClient('clientA')
      .from(TABLES.bookings)
      .insert({
        ...payload,
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      })
      .select('id')
      .maybeSingle();
    if (result.data?.id) {
      recordsRequiringAdminCleanup.push('unauthorized booking insert');
    }
    const owner = payload.client_id === getUserId('clientB') ? 'clientB' : 'clientA';
    const persisted = await selectRows(getClient(owner), TABLES.bookings, 'id', [
      ['eq', 'client_notes', payload.client_notes],
    ]);
    if (persisted.length) {
      recordsRequiringAdminCleanup.push('denied booking insert persisted');
    }
    assert(persisted.length === 0, 'denied booking insert persisted a row');
    expectDenied(result, 'unauthorized booking insert was not denied');
  }
});

addCase('16', 'Client A can read their own booking', async () => {
  const bookings = [
    ...temporaryBookings.map((id) => ({ id })),
    ...(await readOwnBookings('clientA')),
  ];
  const booking = requireRows(bookings, 'Client A booking')[0];
  const visible = await readBooking(getClient('clientA'), booking.id);
  assert(visible.some((row) => row.id === booking.id), 'Client A booking was not returned');
});

addCase('17', 'Provider A can read bookings for own services', async () => {
  const services = await readOwnServices('providerA');
  const ids = services.map((row) => row.id);
  requireRows(ids, 'Provider A service');
  const bookings = await selectRows(
    getClient('providerA'),
    TABLES.bookings,
    'id, service_id',
    [['in', 'service_id', ids]],
  );
  requireRows(bookings, 'booking for Provider A service');
  assert(bookings.every((row) => ids.includes(row.service_id)), 'provider received unrelated booking');
});

addCase('18', 'Client A cannot read Client B booking', async () => {
  const fixture = requireRows(await readOwnBookings('clientB'), 'Client B booking')[0];
  const hidden = await readBooking(getClient('clientA'), fixture.id);
  assert(hidden.length === 0, 'Client A could read Client B booking');
  const visible = await readBooking(getClient('clientB'), fixture.id);
  assert(visible.some((row) => row.id === fixture.id), 'Client B fixture was not readable by its owner');
});

addCase('19', 'Provider A cannot read Provider B booking', async () => {
  const servicesB = await readOwnServices('providerB');
  const idsB = servicesB.map((row) => row.id);
  requireRows(idsB, 'Provider B service');
  const bookingsB = await selectRows(
    getClient('providerB'),
    TABLES.bookings,
    'id, service_id',
    [['in', 'service_id', idsB]],
  );
  const fixture = requireRows(bookingsB, 'booking for Provider B service')[0];
  const hidden = await readBooking(getClient('providerA'), fixture.id);
  assert(hidden.length === 0, 'Provider A could read Provider B booking');
  const visible = await readBooking(getClient('providerB'), fixture.id);
  assert(visible.some((row) => row.id === fixture.id), 'Provider B could not read associated booking');
});

addCase('20', 'Unrelated users cannot read/update/delete bookings', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  if (!temporaryBookings.length) {
    throw new BlockedTest(
      'requires an explicitly opted-in temporary booking for safe update/delete tests',
    );
  }
  const fixture = { id: temporaryBookings[0] };
  const unrelatedRead = await readBooking(getClient('unrelated'), fixture.id);
  assert(unrelatedRead.length === 0, 'unrelated user read a booking');

  const before = await readBooking(getClient('clientA'), fixture.id);
  requireRows(before, 'Client A booking');
  const original = before[0];
  const attempts = [];
  for (const role of ['clientA', 'providerA']) {
    const update = await getClient(role)
      .from(TABLES.bookings)
      .update({ client_notes: `unauthorized ${randomUUID()}` })
      .eq('id', fixture.id)
      .select('id');
    const deletion = await getClient(role)
      .from(TABLES.bookings)
      .delete()
      .eq('id', fixture.id)
      .select('id');
    attempts.push({ role, update, deletion });
  }
  const after = await readBooking(getClient('clientA'), fixture.id);
  if (
    after.length !== 1 ||
    after[0].client_notes !== original.client_notes
  ) {
    if (after.length === 0) {
      await getClient('clientA').from(TABLES.bookings).insert({
        id: original.id,
        client_id: original.client_id,
        service_id: original.service_id,
        scheduled_at: original.scheduled_at,
        client_notes: original.client_notes,
      });
    } else {
      await getClient('clientA')
        .from(TABLES.bookings)
        .update({ client_notes: original.client_notes })
        .eq('id', original.id);
    }
    throw new TestFailure('booking changed after denied update/delete; restoration attempted');
  }
  for (const attempt of attempts) {
    expectDenied(attempt.update, `${attempt.role} updated a booking`);
    expectDenied(attempt.deletion, `${attempt.role} deleted a booking`);
  }
});

addCase('21', 'Anonymous cannot read profiles or write protected tables', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  const profileId = getUserId('providerA');
  const profile = await getClient('anon')
    .from(TABLES.profiles)
    .select('id, display_name')
    .eq('id', profileId);
  if (profile.error) failForResult('anonymous profile read failed', profile);
  assert(profile.data.length === 0, 'anonymous user read a profile');
  const ownProfile = await selectRows(getClient('providerA'), TABLES.profiles, 'display_name', [
    ['eq', 'id', profileId],
  ]);
  const originalProfile = requireRows(ownProfile, 'Provider A profile')[0];
  const profileUpdate = await getClient('anon')
    .from(TABLES.profiles)
    .update({ display_name: originalProfile.display_name })
    .eq('id', profileId)
    .select('id');
  expectDenied(profileUpdate, 'anonymous user updated a profile');
  const profileAfter = await selectRows(getClient('providerA'), TABLES.profiles, 'display_name', [
    ['eq', 'id', profileId],
  ]);
  assert(
    profileAfter[0]?.display_name === originalProfile.display_name,
    'profile changed after rejected anonymous update',
  );

  const service = temporaryServices.find((row) => row.owner === 'providerA');
  if (!service) throw new BlockedTest('requires disposable service fixture for safe write-denial tests');
  const serviceUpdate = await getClient('anon')
    .from(TABLES.services)
    .update({ name: `anon attempt ${randomUUID()}` })
    .eq('id', service.id)
    .select('id');
  const serviceAfterUpdate = await selectRows(
    getClient('providerA'),
    TABLES.services,
    'id, name',
    [['eq', 'id', service.id]],
  );
  if (serviceAfterUpdate[0]?.name !== service.name) {
    await getClient('providerA')
      .from(TABLES.services)
      .update({ name: service.name })
      .eq('id', service.id);
    throw new TestFailure('service changed after rejected anonymous update; restoration attempted');
  }
  expectDenied(serviceUpdate, 'anonymous user updated a service');
  const anonymousServiceName = `RLS anonymous service ${randomUUID()}`;
  const serviceInsert = await getClient('anon')
    .from(TABLES.services)
    .insert({
      provider_id: profileId,
      name: anonymousServiceName,
      description: 'Temporary unauthorized anonymous insert test',
      price_amount: 1,
      currency: 'USD',
      status: 'draft',
    })
    .select('id, provider_id, name, description, status')
    .maybeSingle();
  const persistedAnonymousService = await selectRows(
    getClient('providerA'),
    TABLES.services,
    'id, provider_id, name, description, status',
    [['eq', 'name', anonymousServiceName]],
  );
  if (persistedAnonymousService.length) {
    temporaryServices.push({
    owner: 'providerA',
    ...persistedAnonymousService[0],
    });
    throw new TestFailure('anonymous service insert persisted; cleanup attempted');
  }
  expectDenied(serviceInsert, 'anonymous user inserted a service');

  const serviceDelete = await getClient('anon')
    .from(TABLES.services)
    .delete()
    .eq('id', service.id)
    .select('id');
  const serviceAfterDelete = await selectRows(
    getClient('providerA'),
    TABLES.services,
    'id',
    [['eq', 'id', service.id]],
  );
  if (!serviceAfterDelete.length) {
    const restored = await getClient('providerA')
      .from(TABLES.services)
      .insert({
      id: service.id,
      provider_id: getUserId('providerA'),
      name: service.name,
      description: service.description,
      price_amount: 1,
      currency: 'USD',
      status: 'draft',
    })
    .select('id')
    .maybeSingle();
    if (restored.error) {
      throw new TestFailure(
        'anonymous deleted a test service; restoration failed',
        restored.error.code,
      );
    }
  }
  expectDenied(serviceDelete, 'anonymous user deleted a service');
  assert(serviceAfterDelete.length === 1, 'service is missing after anonymous delete attempt');

  const categories = await selectRows(
    getClient('anon'),
    TABLES.categories,
    'id, name',
    [['eq', 'is_active', true]],
  );
  const category = requireRows(categories, 'active category')[0];
  const categoryUpdate = await getClient('anon')
    .from(TABLES.categories)
    .update({ name: category.name })
    .eq('id', category.id)
    .select('id');
  const categoryAfterUpdate = await selectRows(
    getClient('anon'),
    TABLES.categories,
    'id, name',
    [['eq', 'id', category.id]],
  );
  assert(categoryAfterUpdate[0]?.name === category.name, 'category changed after anonymous update');
  expectDenied(categoryUpdate, 'anonymous user updated a category');

  const mapping = temporaryMappings.find((row) => row.owner === 'providerA');
  if (!mapping) throw new BlockedTest('requires a disposable Provider A mapping for anonymous mapping tests');
  {
    const category = await selectRows(
      getClient('providerA'),
      TABLES.categories,
      'id',
      [['eq', 'id', mapping.category_id]],
    );
    if (category.length === 0) {
      throw new BlockedTest('provider mapping category is not readable for safe anonymous-write checks');
    }
    const activeCategories = await selectRows(
      getClient('anon'),
      TABLES.categories,
      'id',
      [['eq', 'is_active', true]],
    );
    let unusedCategory;
    for (const candidate of activeCategories) {
      const existing = await selectRows(
        getClient('providerA'),
        TABLES.mappings,
        'category_id',
        [
          ['eq', 'service_id', mapping.service_id],
          ['eq', 'category_id', candidate.id],
        ],
      );
      if (!existing.length) {
        unusedCategory = candidate;
        break;
      }
    }
    if (!unusedCategory) {
      throw new BlockedTest('no unused active category for anonymous mapping insert check');
    }
    const mappingInsert = await getClient('anon')
      .from(TABLES.mappings)
      .insert({
        service_id: mapping.service_id,
        category_id: unusedCategory.id,
      })
      .select('service_id')
      .maybeSingle();
    if (mappingInsert.data?.service_id) {
      temporaryMappings.push({
        owner: 'providerA',
        service_id: mapping.service_id,
        category_id: unusedCategory.id,
      });
    }
    const persistedMapping = await selectRows(
      getClient('providerA'),
      TABLES.mappings,
      'service_id',
      [
        ['eq', 'service_id', mapping.service_id],
        ['eq', 'category_id', unusedCategory.id],
      ],
    );
    if (persistedMapping.length) {
      temporaryMappings.push({
        owner: 'providerA',
        service_id: mapping.service_id,
        category_id: unusedCategory.id,
      });
      throw new TestFailure('anonymous mapping insert persisted; cleanup attempted');
    }
    expectDenied(mappingInsert, 'anonymous user inserted a mapping');

    const mappingDelete = await getClient('anon')
      .from(TABLES.mappings)
      .delete()
      .eq('service_id', mapping.service_id)
      .eq('category_id', mapping.category_id)
      .select('service_id');
    if (mappingDelete.data?.length) {
      await getClient('providerA')
        .from(TABLES.mappings)
        .insert({ service_id: mapping.service_id, category_id: mapping.category_id });
    }
    const mappingAfter = await selectRows(
      getClient('providerA'),
      TABLES.mappings,
      'service_id',
      [
        ['eq', 'service_id', mapping.service_id],
        ['eq', 'category_id', mapping.category_id],
      ],
    );
    if (!mappingAfter.length) {
      await getClient('providerA')
        .from(TABLES.mappings)
        .insert({ service_id: mapping.service_id, category_id: mapping.category_id });
      throw new TestFailure('anonymous deleted a mapping; restoration attempted');
    }
    expectDenied(mappingDelete, 'anonymous user deleted a mapping');
  }

  const disposableCategoryId = process.env.RLS_DISPOSABLE_CATEGORY_ID;
  if (!disposableCategoryId) {
    throw new BlockedTest(
      'set RLS_DISPOSABLE_CATEGORY_ID to a disposable category with no mappings to test anonymous delete',
    );
  }
  const categoryDelete = await getClient('anon')
    .from(TABLES.categories)
    .delete()
    .eq('id', disposableCategoryId)
    .select('id');
  if (categoryDelete.data?.length) {
    recordsRequiringAdminCleanup.push('anonymous category delete');
  }
  expectDenied(categoryDelete, 'anonymous user deleted a category');

  const categoryInsert = await getClient('anon')
    .from(TABLES.categories)
    .insert({
      name: `RLS anon ${randomUUID()}`,
      slug: `rls-anon-${randomUUID()}`,
      is_active: true,
    })
    .select('id')
    .maybeSingle();
  if (categoryInsert.data?.id) {
    recordsRequiringAdminCleanup.push('anonymous category insert');
  }
  expectDenied(categoryInsert, 'anonymous user inserted a category');
});

addCase('22', 'Authenticated users cannot read/update another user profile', async () => {
  requireFlag(allowRiskyTests, 'RLS_ALLOW_RISKY_TESTS');
  const idB = getUserId('providerB');
  const read = await getClient('providerA')
    .from(TABLES.profiles)
    .select('id')
    .eq('id', idB);
  if (read.error) failForResult('cross-user profile read failed', read);
  assert(read.data.length === 0, 'Provider A read Provider B profile');

  const original = await selectRows(getClient('providerB'), TABLES.profiles, 'display_name', [
    ['eq', 'id', idB],
  ]);
  const profile = requireRows(original, 'Provider B profile')[0];
  const update = await getClient('providerA')
    .from(TABLES.profiles)
    .update({ display_name: `unauthorized ${randomUUID()}` })
    .eq('id', idB)
    .select('id');
  const unchanged = await selectRows(getClient('providerB'), TABLES.profiles, 'display_name', [
    ['eq', 'id', idB],
  ]);
  if (unchanged[0]?.display_name !== profile.display_name) {
    await getClient('providerB')
      .from(TABLES.profiles)
      .update({ display_name: profile.display_name })
      .eq('id', idB);
    throw new TestFailure('Provider B profile changed after rejected update; restoration attempted');
  }
  expectDenied(update, 'Provider A modified Provider B profile');
});

if (missingConfiguration.length) {
  console.log('RLS test configuration is incomplete; no database cases were run.');
  console.log(`Missing configuration: ${missingConfiguration.join(', ')}`);
  for (const testCase of cases) {
    results.push({
      id: testCase.id,
      name: testCase.name,
      status: 'Blocked',
      detail: 'Supabase URL, publishable key, and all five test sessions are required',
    });
  }
} else {
  for (const testCase of cases) await runCase(testCase);
}

const cleanupProblems = missingConfiguration.length
  ? []
  : await cleanupTemporaryRecords();

console.log('\nRLS scenario results (no passwords, keys, or error messages are printed):');
for (const result of results) {
  const detail = result.detail ? ` — ${result.detail}` : '';
  console.log(`${result.id}. ${result.status}: ${result.name}${detail}`);
}

if (recordsRequiringAdminCleanup.length) {
  cleanupProblems.push(
    `${recordsRequiringAdminCleanup.length} unexpected test write(s) may require trusted admin cleanup`,
  );
}

if (cleanupProblems.length) {
  console.log('\nCleanup/manual follow-up required:');
  for (const problem of cleanupProblems) console.log(`- ${problem}`);
}

const counts = Object.fromEntries(
  ['Passed', 'Failed', 'Blocked'].map((status) => [
    status,
    results.filter((result) => result.status === status).length,
  ]),
);
console.log(
  `\nTotals: ${counts.Passed} passed, ${counts.Failed} failed, ${counts.Blocked} blocked.`,
);

for (const session of Object.values(sessions)) {
  if (session?.client) await session.client.auth.signOut();
}

if (counts.Failed > 0 || cleanupProblems.length > 0) process.exitCode = 1;
