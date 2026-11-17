import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTAINER_PORT } from './forwarding.js';
import { stopContainer, waitForReadyContainer, type ReadinessContainer } from './readiness.js';

const fastTiming = { timeoutMilliseconds: 200, retryDelayMilliseconds: 5, requestTimeoutMilliseconds: 50 };

function createFakeContainer(answer: (attempt: number) => Promise<Response>) {
  const calls = { probes: [] as string[], ports: [] as number[], destroyed: [] as unknown[] };
  let exit: () => void = () => {};
  const exited = new Promise<void>(resolve => {
    exit = resolve;
  });
  const container: ReadinessContainer & { running: boolean } = {
    running: true,
    getTcpPort(port) {
      calls.ports.push(port);
      return {
        fetch(input) {
          calls.probes.push(input);
          return answer(calls.probes.length);
        },
      };
    },
    monitor: () => exited,
    async destroy(reason) {
      calls.destroyed.push(reason);
      container.running = false;
      exit();
    },
  };
  return { container, calls };
}

test('resolves once the container answers on its port, even with a non-2xx status', async () => {
  const { container, calls } = createFakeContainer(async attempt => {
    if (attempt < 3) throw new Error('connection refused');
    return new Response('forbidden', { status: 403 });
  });

  await waitForReadyContainer(container, fastTiming);

  assert.deepEqual(calls.ports, [CONTAINER_PORT]);
  assert.equal(calls.probes.length, 3);
  assert.equal(calls.probes[0], 'http://container/health');
  assert.deepEqual(calls.destroyed, []);
});

test('stops a running container that never answers and rejects', async () => {
  const { container, calls } = createFakeContainer(async () => {
    throw new Error('connection refused');
  });

  await assert.rejects(waitForReadyContainer(container, fastTiming), /did not answer on port 8080/);

  assert.deepEqual(calls.destroyed, ['did not become ready']);
  assert.equal(container.running, false);
});

test('rejects early without stopping when the container has already exited', async () => {
  const { container, calls } = createFakeContainer(async () => {
    container.running = false;
    throw new Error('connection refused');
  });

  await assert.rejects(waitForReadyContainer(container, fastTiming), /exited before it answered/);

  assert.equal(calls.probes.length, 1);
  assert.deepEqual(calls.destroyed, []);
});

test('stopContainer destroys the container and waits for it to exit', async () => {
  const { container, calls } = createFakeContainer(async () => new Response('ok'));

  await stopContainer(container, 'settings changed');

  assert.deepEqual(calls.destroyed, ['settings changed']);
  assert.equal(container.running, false);
});
