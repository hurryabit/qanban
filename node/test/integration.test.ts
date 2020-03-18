import { ChildProcess, spawn } from 'child_process';
import waitOn from 'wait-on';
import path from 'path';
import fs from 'fs';
import os from 'os';
import fetch from 'node-fetch';
import { Contract, Id, idDecoder, contractDecoder, Command, CreateCommand, Party } from 'qanban-types';
import * as jtv from '@mojotech/json-type-validation';

type Participant = {
  readonly name: Party;
  readonly port: number;
  proc?: ChildProcess;
}

const alice: Participant = {name: 'Alice' as Party, port: 7481};
const bob: Participant = {name: 'Bob' as Party, port: 7482};
const participants = [alice, bob];

const ROUTER_PORT= 7480;

let databaseDir: string | undefined = undefined;
let routerProcess: ChildProcess | undefined = undefined;

async function startNode(participant: Participant): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const database = path.join(databaseDir!, `${participant.name}.db`);
  participant.proc = spawn('yarn',[
    'run', 'qanban-node',
    `--name=${participant.name}`, `--port=${participant.port}`, `--router=localhost:${ROUTER_PORT}`,
    `--database=${database}`, '--clean',
  ], {stdio: "inherit"});
  await waitOn({resources: [`tcp:${participant.port}`]});
  console.log(`node for ${participant.name} up`);
}

async function query(participant: Participant): Promise<{id: Id; contract: Contract}[]> {
  const res = await fetch(`http://localhost:${participant.port}/api/query`, {method: "GET"});
  expect(res.ok).toBe(true);
  const json = await res.json();
  const contracts = jtv.array(jtv.object({
    id: idDecoder(),
    contract: contractDecoder(),
  })).runWithException(json);
  return contracts;
}

async function submit(participant: Participant, command: Command): Promise<void> {
  const res = await fetch(`http://localhost:${participant.port}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  expect(res.ok).toBe(true);
}

beforeAll(async () => {
  const env = {...process.env, PORT: ROUTER_PORT.toString()};
  routerProcess = spawn('yarn', ['run', 'qanban-router'], {env, stdio: "inherit"});
  await waitOn({resources: [`tcp:localhost:${ROUTER_PORT}`]});
  console.log('router up');

  databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qanban'));

  await Promise.all(participants.map(startNode));
}, 10_000);

afterAll(() => {
  if (routerProcess) {
    routerProcess.kill();
    console.log('router down');
  }

  if (databaseDir) {
    fs.rmdirSync(databaseDir, {recursive: true});
  }

  for (const participant of participants) {
    if (participant.proc !== undefined) {
      participant.proc.kill();
      console.log(`node for ${participant.name} up`);
    }
  }
});

test("integration", async () => {
  expect(await query(alice)).toEqual([]);
  expect(await query(bob)).toEqual([]);

  const proposalCommand: CreateCommand = {
    type: "propose",
    description: "Bake a cake",
    assignee: bob.name,
    reviewers: [alice.name],
  };
  await submit(alice, proposalCommand);

  const contract: Contract = {
    state: "PROPOSED",
    description: proposalCommand.description,
    proposer: alice.name,
    assignee: proposalCommand.assignee,
    reviewers: proposalCommand.reviewers,
    comments: [],
    missingAcceptances: [bob.name],
    missingApprovals: [],
  };
  const aliceContracts = await query(alice);
  expect(aliceContracts).toHaveLength(1);
  expect(aliceContracts[0].contract).toEqual(contract);
  expect(await query(bob)).toEqual(aliceContracts);

  const id = aliceContracts[0].id;

  await submit(bob, {id, type: "accept"});
  contract.state = "ACCEPTED";
  contract.missingAcceptances = [];
  expect(await query(alice)).toEqual([{id, contract}]);
  expect(await query(bob)).toEqual([{id, contract}]);

  await submit(bob, {id, type: "start"});
  contract.state = "IN_PROGRESS";
  expect(await query(alice)).toEqual([{id, contract}]);
  expect(await query(bob)).toEqual([{id, contract}]);

  await submit(bob, {id, type: "finish"});
  contract.state = "IN_REVIEW";
  contract.missingApprovals = [alice.name];
  expect(await query(alice)).toEqual([{id, contract}]);
  expect(await query(bob)).toEqual([{id, contract}]);

  const comment = 'More icing!';
  await submit(alice, {id, type: "reject", comment});
  contract.state = "IN_PROGRESS";
  contract.comments = [comment];
  contract.missingApprovals = [];
  expect(await query(alice)).toEqual([{id, contract}]);
  expect(await query(bob)).toEqual([{id, contract}]);

  await submit(bob, {id, type: "finish"});
  contract.state = "IN_REVIEW";
  contract.missingApprovals = [alice.name];
  expect(await query(alice)).toEqual([{id, contract}]);
  expect(await query(bob)).toEqual([{id, contract}]);

  await submit(alice, {id, type: "approve"});
  contract.state = "DONE";
  contract.missingApprovals = [];
  expect(await query(alice)).toEqual([{id, contract}]);
  expect(await query(bob)).toEqual([{id, contract}]);
}, 10_000);
