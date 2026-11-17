import { DurableObject } from 'cloudflare:workers';

import {
  CONTAINER_PORT,
  getContainerEnvironment,
  getContainerUrl,
  getEnvironmentFingerprint,
  getForwardedHeaders,
} from './forwarding.js';
import { stopContainer, waitForReadyContainer } from './readiness.js';

// Six hours is Cloudflare's maximum inactivity timeout.
const INACTIVITY_TIMEOUT_MILLISECONDS = 6 * 60 * 60 * 1000;
const FINGERPRINT_STORAGE_KEY = 'environment-fingerprint';
// One named instance keeps every MCP session in one process, like the single Railway replica.
const INSTANCE_NAME = 'main';
// The API runs in Virginia, so the instance and its container are pinned to Eastern North America.
const LOCATION_HINT = 'enam';

type ContainerControl = NonNullable<DurableObjectState['container']>;

export class McpContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private ready = false;

  constructor(state: DurableObjectState, environment: Env) {
    super(state, environment);
    const container = this.getContainer();
    // A restarted Durable Object loses its exit watcher and inactivity timeout, so a running container gets both again.
    if (container.running) {
      this.watchContainer();
      void state.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MILLISECONDS));
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.ready || !this.getContainer().running) {
      this.starting ??= this.startContainer().finally(() => {
        this.starting = undefined;
      });
      try {
        await this.starting;
      } catch (error) {
        console.error('presscart-mcp container failed to start.', error);
        return getUnavailableResponse();
      }
    }

    const forwarded = new Request(getContainerUrl(request.url), {
      method: request.method,
      headers: getForwardedHeaders(request.url, request.headers),
      body: request.body,
      // Redirects belong to the client, such as the OAuth hand-off to Supabase.
      redirect: 'manual',
    });
    try {
      return await this.getContainer().getTcpPort(CONTAINER_PORT).fetch(forwarded);
    } catch (error) {
      // The container may have exited since the readiness check, so the next request starts it again.
      this.ready = false;
      console.error('presscart-mcp container request failed.', error);
      return getUnavailableResponse();
    }
  }

  private getContainer(): ContainerControl {
    const container = this.ctx.container;
    if (!container) throw new Error('McpContainer is not bound to a container.');
    return container;
  }

  private watchContainer(): void {
    // When the container exits for any reason, the next request starts it again.
    this.getContainer()
      .monitor()
      .catch(() => undefined)
      .then(() => {
        this.ready = false;
      });
  }

  private async startContainer(): Promise<void> {
    this.ready = false;
    const container = this.getContainer();
    const environment = getContainerEnvironment(this.env);
    const fingerprint = await getEnvironmentFingerprint(environment);
    const startedWith = await this.ctx.storage.get<string>(FINGERPRINT_STORAGE_KEY);

    if (container.running && startedWith !== fingerprint) {
      // Settings changed since this container started, so it restarts with the new ones.
      await stopContainer(container, 'settings changed');
    }

    if (!container.running) {
      container.start({ enableInternet: true, env: environment });
      this.watchContainer();
      await this.ctx.storage.put(FINGERPRINT_STORAGE_KEY, fingerprint);
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MILLISECONDS);
    await waitForReadyContainer(container);
    this.ready = true;
  }
}

function getUnavailableResponse(): Response {
  return new Response('Service is unavailable, try again shortly.', {
    status: 503,
    headers: { 'Retry-After': '5', 'Content-Type': 'text/plain' },
  });
}

function getMainContainer(environment: Env) {
  return environment.MCP_CONTAINER.getByName(INSTANCE_NAME, { locationHint: LOCATION_HINT });
}

export default {
  fetch(request, environment) {
    return getMainContainer(environment).fetch(request);
  },
  scheduled(_controller, environment, context) {
    // This only pings /health so the container stays awake.
    const healthUrl = new URL('/health', environment.MCP_SERVER_URL).toString();
    context.waitUntil(
      getMainContainer(environment)
        .fetch(healthUrl)
        .then(async response => {
          await response.body?.cancel();
          // A 5xx means the container did not start, so the Cron event is marked failed.
          if (response.status >= 500) throw new Error(`Health ping failed with status ${response.status}.`);
        })
    );
  },
} satisfies ExportedHandler<Env>;
