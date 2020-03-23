import { ChildProcess, spawn } from 'child_process';
import waitOn from 'wait-on';
import pEvent from 'p-event';
import QuredClient, { PartyId, Message } from '../src';

const ROUTER_PORT= 7475;
const router = `ws://localhost:${ROUTER_PORT}`;
let routerProcess: ChildProcess | undefined = undefined;

beforeAll(async () => {
  const env = {...process.env, PORT: ROUTER_PORT.toString()};
  routerProcess = spawn('yarn', ['run', 'qured-router'], {env, stdio: "inherit"});
  await waitOn({resources: [`tcp:localhost:${ROUTER_PORT}`]});
  console.log('qured-router up');
}, 10_000);

afterAll(() => {
  if (routerProcess) {
    routerProcess.kill();
    console.log('qured-router down');
  }
});

test("integration", async () => {
  const alice = PartyId('Alice');
  const bob = PartyId('Bob');
  const carol = PartyId('Carol');

  // Alice connects.
  const aliceClient = new QuredClient<string>({router, login: alice});
  const aliceStream = pEvent.iterator(aliceClient, "message", {resolutionEvents: ["close"], rejectionEvents: ["error"]});
  await pEvent(aliceClient, "open");

  // Alice sends herself a message.
  const message1: Message<string> = {sender: alice, receivers: [alice], payload: "1"};
  aliceClient.send(message1);
  expect(await aliceStream.next()).toEqual({done: false, value: message1});

  // Alice sends a message to Bob, who connects right after.
  const message2: Message<string> = {sender: alice, receivers: [bob], payload: "2"};
  aliceClient.send(message2);
  const bobClient = new QuredClient<string>({router, login: bob});
  const bobStream = pEvent.iterator(bobClient, "message", {resolutionEvents: ["close"], rejectionEvents: ["error"]});
  await pEvent(bobClient, "open");
  expect(await bobStream.next()).toEqual({done: false, value: message2});

  // Bob sends a message to Alice and Carol, who connects right after.
  const message3: Message<string> = {sender: bob, receivers: [alice, carol], payload: "3"};
  bobClient.send(message3);
  expect(await aliceStream.next()).toEqual({done: false, value: message3});
  const carolClient = new QuredClient<string>({router, login: carol});
  const carolStream = pEvent.iterator(carolClient, "message", {resolutionEvents: ["close"], rejectionEvents: ["error"]});
  await pEvent(carolClient, "open");
  expect(await carolStream.next()).toEqual({done: false, value: message3});

  // Everybody closes their connection.
  aliceClient.close();
  expect((await aliceStream.next()).done).toBe(true);
  bobClient.close();
  expect((await bobStream.next()).done).toBe(true);
  carolClient.close();
  expect((await carolStream.next()).done).toBe(true);
});
