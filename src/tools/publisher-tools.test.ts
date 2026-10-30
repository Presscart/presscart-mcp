import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
process.env.MCP_INTERNAL_AUTH_TOKEN = 'internal-token-placeholder';
delete process.env.PRESSCART_APP_URL;

const { createPresscartMcpServer } = await import('../server.js');
const { connectInMemoryClient, jsonResponse, readTextContent } = await import(
  '../directory/mcp-client.fixtures.js'
);

const TEAM_SLUG = 'acme-media';
const TEAM_ID = '0f9c2a52-1d7b-4c55-9b0e-3f4f6c1a2b3c';
const OUTLET_ID = '6b2f4eb8-46db-4ef2-9c44-46b94a7049c7';
const PRODUCT_ID = 'c5d1e8a0-7f3b-4a62-8d19-2b4e6f7a9c01';
const DOCUMENT_KEY = `outlet-authorizations/${TEAM_ID}/abcdefghijklmnopqrstu.pdf`;
const PDF_BASE64 = Buffer.from('%PDF-1.4 authorization letter').toString('base64');

const oauthAuthInfo = {
  token: 'oauth-access-token',
  extra: { source: 'mcp', sub: 'user-1', oauth_grant_id: 'grant-1' },
};

type RecordedCall = {
  method: string;
  url: URL;
  body: string | FormData | undefined;
};

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

async function callTool(
  name: string,
  args: Record<string, unknown>,
  respond: (call: RecordedCall) => Response = () => jsonResponse({ ok: true })
) {
  const calls: RecordedCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      body: init?.body as RecordedCall['body'],
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;

  const { client, close } = await connectInMemoryClient(
    createPresscartMcpServer({ getSessionAuthInfo: () => oauthAuthInfo })
  );

  try {
    const result = (await client
      .callTool({ name, arguments: args })
      .catch((error: unknown) => ({ isError: true, error }))) as ToolResult;
    return { result, calls };
  } finally {
    await close();
    globalThis.fetch = originalFetch;
  }
}

function getJsonBody(call: RecordedCall | undefined) {
  assert.equal(typeof call?.body, 'string');
  return JSON.parse(call?.body as string);
}

test('get_outlet_statistics reads the publisher team outlet counts by status', async () => {
  const { result, calls } = await callTool('get_outlet_statistics', { team_slug: TEAM_SLUG });

  assert.notEqual(result.isError, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.url.pathname, `/teams/${TEAM_SLUG}/outlets/stats`);
});

test('start_outlet_domain_verification returns the ownership instructions for an outlet', async () => {
  const { result, calls } = await callTool('start_outlet_domain_verification', {
    team_slug: TEAM_SLUG,
    outlet_id: OUTLET_ID,
  });

  assert.notEqual(result.isError, true);
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(
    calls[0]?.url.pathname,
    `/teams/${TEAM_SLUG}/outlets/${OUTLET_ID}/domain-verification`
  );
});

test('verify_outlet_domain asks the API to check the outlet domain now', async () => {
  const { result, calls } = await callTool('verify_outlet_domain', {
    team_slug: TEAM_SLUG,
    outlet_id: OUTLET_ID,
  });

  assert.notEqual(result.isError, true);
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(
    calls[0]?.url.pathname,
    `/teams/${TEAM_SLUG}/outlets/${OUTLET_ID}/domain-verification/verify`
  );
});

test('get_outlet_authorization reads the outlet ownership authorization', async () => {
  const { result, calls } = await callTool('get_outlet_authorization', {
    team_slug: TEAM_SLUG,
    outlet_id: OUTLET_ID,
  });

  assert.notEqual(result.isError, true);
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.url.pathname, `/teams/${TEAM_SLUG}/outlets/${OUTLET_ID}/authorization`);
});

test('get_outlet_authorization reports that nothing was submitted when the API has no authorization', async () => {
  const { result } = await callTool(
    'get_outlet_authorization',
    { team_slug: TEAM_SLUG, outlet_id: OUTLET_ID },
    () => jsonResponse({ name: 'NotFoundError', message: 'Outlet authorization not found.' }, 404)
  );

  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent?.submitted, false);
  assert.match(String(result.structuredContent?.next_step), /submit_outlet_authorization/);
});

test('get_outlet_authorization still reports a missing outlet as an error', async () => {
  const { result } = await callTool(
    'get_outlet_authorization',
    { team_slug: TEAM_SLUG, outlet_id: OUTLET_ID },
    () => jsonResponse({ name: 'NotFoundError', message: 'Outlet not found.' }, 404)
  );

  assert.equal(result.isError, true);
});

test('submit_outlet_authorization uploads the document as authorization evidence, then submits it', async () => {
  const { result, calls } = await callTool(
    'submit_outlet_authorization',
    {
      team_slug: TEAM_SLUG,
      outlet_id: OUTLET_ID,
      document: {
        file_name: 'authorization-letter.pdf',
        mime_type: 'application/pdf',
        content_base64: PDF_BASE64,
      },
      authorizer_name: 'Jane Smith',
      authorizer_email: 'jane@outlet.example',
      authorizer_role: 'Editor-in-chief',
    },
    call =>
      call.url.pathname.endsWith('/files/upload')
        ? jsonResponse({ files: [{ file_key: DOCUMENT_KEY }] }, 201)
        : jsonResponse({ status: 'PENDING' }, 201)
  );

  assert.notEqual(result.isError, true);
  assert.equal(calls.length, 2);

  const upload = calls[0];
  assert.equal(upload?.method, 'POST');
  assert.equal(upload?.url.pathname, `/teams/${TEAM_SLUG}/files/upload`);
  assert.ok(upload?.body instanceof FormData);
  assert.equal(upload.body.get('purpose'), 'outlet_authorization');
  assert.equal((upload.body.get('files') as File).name, 'authorization-letter.pdf');

  const submission = calls[1];
  assert.equal(submission?.method, 'POST');
  assert.equal(
    submission?.url.pathname,
    `/teams/${TEAM_SLUG}/outlets/${OUTLET_ID}/authorization`
  );
  assert.deepEqual(getJsonBody(submission), {
    document_key: DOCUMENT_KEY,
    authorizer_name: 'Jane Smith',
    authorizer_email: 'jane@outlet.example',
    authorizer_role: 'Editor-in-chief',
  });
});

test('submit_outlet_authorization only accepts PDF, DOC, or DOCX documents', async () => {
  const { result, calls } = await callTool('submit_outlet_authorization', {
    team_slug: TEAM_SLUG,
    outlet_id: OUTLET_ID,
    document: {
      file_name: 'authorization-letter.png',
      mime_type: 'image/png',
      content_base64: PDF_BASE64,
    },
    authorizer_name: 'Jane Smith',
    authorizer_email: 'jane@outlet.example',
    authorizer_role: 'Editor-in-chief',
  });

  assert.equal(result.isError, true);
  assert.match(readTextContent(result), /Input validation error[\s\S]*image\/png/);
  assert.equal(calls.length, 0);
});

test('submit_outlet_authorization explains when the file name is not a PDF, DOC, or DOCX', async () => {
  const { result, calls } = await callTool('submit_outlet_authorization', {
    team_slug: TEAM_SLUG,
    outlet_id: OUTLET_ID,
    document: {
      file_name: 'authorization-letter.png',
      mime_type: 'application/pdf',
      content_base64: PDF_BASE64,
    },
    authorizer_name: 'Jane Smith',
    authorizer_email: 'jane@outlet.example',
    authorizer_role: 'Editor-in-chief',
  });

  assert.equal(result.isError, true);
  assert.match(readTextContent(result), /\.pdf, \.doc, or \.docx/);
  assert.equal(calls.length, 0);
});

test('submit_outlet_authorization does not submit when the upload returns no document', async () => {
  const { result, calls } = await callTool(
    'submit_outlet_authorization',
    {
      team_slug: TEAM_SLUG,
      outlet_id: OUTLET_ID,
      document: {
        file_name: 'authorization-letter.pdf',
        mime_type: 'application/pdf',
        content_base64: PDF_BASE64,
      },
      authorizer_name: 'Jane Smith',
      authorizer_email: 'jane@outlet.example',
      authorizer_role: 'Editor-in-chief',
    },
    () => jsonResponse({ files: [] }, 201)
  );

  assert.equal(result.isError, true);
  assert.equal(calls.length, 1);
});

test('set_product_active switches only the product status', async () => {
  const { result, calls } = await callTool(
    'set_product_active',
    { team_slug: TEAM_SLUG, product_id: PRODUCT_ID, active: false },
    () => jsonResponse({ message: 'Product status updated', active: false })
  );

  assert.notEqual(result.isError, true);
  assert.equal(calls[0]?.method, 'PATCH');
  assert.equal(calls[0]?.url.pathname, `/teams/${TEAM_SLUG}/products/${PRODUCT_ID}/status`);
  assert.deepEqual(getJsonBody(calls[0]), { active: false });
});

const agreementTemplate = {
  id: '4a1d5f2e-8b3c-4e7a-9f60-1c2d3e4f5a6b',
  key: 'publisher_agreement',
  name: 'Presscart Publisher Agreement',
  title: 'Presscart Publisher Agreement',
  content_markdown: 'Full publisher agreement text.',
  acceptance_label: 'I agree to the Presscart Publisher Agreement.',
};

test('get_publisher_agreement_status reports a signed agreement without signer details', async () => {
  const { result, calls } = await callTool(
    'get_publisher_agreement_status',
    { team_id: TEAM_ID },
    () =>
      jsonResponse({
        template: agreementTemplate,
        acceptance: {
          id: '9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4',
          accepted_at: '2026-10-01T00:00:00.000Z',
          signer_name: 'Jane Smith',
          signer_email: 'jane@outlet.example',
          signer_ip: '203.0.113.25',
          signer_user_agent: 'Mozilla/5.0',
        },
        is_accepted: true,
        pdf_url: null,
      })
  );

  assert.notEqual(result.isError, true);
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.url.pathname, '/agreements/publisher_agreement');
  assert.equal(calls[0]?.url.searchParams.get('team_id'), TEAM_ID);
  assert.equal(result.structuredContent?.is_accepted, true);
  assert.equal(result.structuredContent?.accepted_at, '2026-10-01T00:00:00.000Z');

  const text = readTextContent(result);
  assert.doesNotMatch(text, /203\.0\.113\.25/);
  assert.doesNotMatch(text, /Mozilla/);
  assert.doesNotMatch(text, /jane@outlet\.example/);
  assert.doesNotMatch(text, /Full publisher agreement text/);
});

test('get_publisher_agreement_status hands an unsigned publisher the dashboard link to sign', async () => {
  const { result } = await callTool('get_publisher_agreement_status', { team_id: TEAM_ID }, () =>
    jsonResponse({ template: agreementTemplate, acceptance: null, is_accepted: false, pdf_url: null })
  );

  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent?.is_accepted, false);
  assert.equal(result.structuredContent?.accepted_at, null);
  assert.equal(
    result.structuredContent?.agreement_page_url,
    'https://app.presscart.test/publisher/settings'
  );
});

async function getToolDescription(name: string) {
  const { client, close } = await connectInMemoryClient(createPresscartMcpServer({}));
  try {
    const { tools } = await client.listTools();
    return tools.find(tool => tool.name === name)?.description ?? '';
  } finally {
    await close();
  }
}

test('update_outlet tells agents to check the agreement before setting an outlet ACTIVE', async () => {
  assert.match(await getToolDescription('update_outlet'), /get_publisher_agreement_status/);
});

test('set_product_active explains that a product with no linked outlet stays inactive', async () => {
  assert.match(await getToolDescription('set_product_active'), /no linked outlet/i);
});

test('submit_outlet_authorization sends large documents to the dashboard instead', async () => {
  const description = await getToolDescription('submit_outlet_authorization');
  assert.match(description, /70 KB/);
  assert.match(description, /dashboard/);
});
