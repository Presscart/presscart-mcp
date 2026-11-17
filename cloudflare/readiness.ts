import { CONTAINER_PORT } from './forwarding.js';

/** The parts of a platform container that the readiness helpers use. */
export interface ReadinessContainer {
  readonly running: boolean;
  getTcpPort(port: number): { fetch(input: string, options?: RequestInit): Promise<Response> };
  monitor(): Promise<void>;
  destroy(reason?: unknown): Promise<void>;
}

/** How long readiness keeps probing the port, how long it waits between probes, and how long each probe may take. */
export interface ReadinessTiming {
  timeoutMilliseconds: number;
  retryDelayMilliseconds: number;
  requestTimeoutMilliseconds: number;
}

/** Probes for up to one minute, 200 milliseconds apart, each probe allowed one second. */
const DEFAULT_READINESS_TIMING: ReadinessTiming = {
  timeoutMilliseconds: 60_000,
  retryDelayMilliseconds: 200,
  requestTimeoutMilliseconds: 1000,
};

/** Resolves once the container answers HTTP on its port before the deadline, and rejects early if the container exits. */
async function waitForPort(container: ReadinessContainer, timing: ReadinessTiming): Promise<void> {
  const port = container.getTcpPort(CONTAINER_PORT);
  const deadline = Date.now() + timing.timeoutMilliseconds;
  let lastError: unknown;

  // The Workers clock advances only across I/O, which every probe and wait performs.
  while (Date.now() < deadline) {
    // A container that has exited will never answer, so probing stops here.
    if (!container.running) {
      throw new Error(`presscart-mcp exited before it answered on port ${CONTAINER_PORT}.`, { cause: lastError });
    }
    try {
      // Any HTTP answer means Express is listening, because its host check answers 403 here.
      const response = await port.fetch('http://container/health', {
        signal: AbortSignal.timeout(timing.requestTimeoutMilliseconds),
      });
      await response.body?.cancel();
      return;
    } catch (error) {
      lastError = error;
      await wait(timing.retryDelayMilliseconds);
    }
  }

  throw new Error(`presscart-mcp did not answer on port ${CONTAINER_PORT}.`, { cause: lastError });
}

/** Stops the container and resolves once it has exited. */
export async function stopContainer(container: ReadinessContainer, reason: string): Promise<void> {
  const exited = container.monitor().catch(() => undefined);
  await container.destroy(reason);
  await exited;
}

/** Resolves once the container is ready, and stops a container that is still running when it never became ready. */
export async function waitForReadyContainer(
  container: ReadinessContainer,
  timing: ReadinessTiming = DEFAULT_READINESS_TIMING
): Promise<void> {
  try {
    await waitForPort(container, timing);
  } catch (error) {
    // The next request would otherwise reuse a container that never answered.
    if (container.running) {
      // A failed stop is only logged, so the caller still sees why readiness failed.
      await stopContainer(container, 'did not become ready').catch(stopError => {
        console.error('presscart-mcp container could not be stopped.', stopError);
      });
    }
    throw error;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
