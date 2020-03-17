import * as jtv from '@mojotech/json-type-validation';
import sqlite3 from 'better-sqlite3';
import express from 'express';
import WebSocket from 'ws';
import { Command, commandDecoder, Contract, contractDecoder, ContractState, Id, idDecoder, Message, messageDecoder, Party, partyDecoder, UpdateMessage } from 'qanban-types';
import { v4 as uuidV4 } from 'uuid';
import yargs from 'yargs';
import os from 'os';
import path from 'path';
import fs from 'fs';

type Ledger = Readonly<{
  list(): Id[];
  fetch(id: Id): Contract | undefined;
  fetchAll(): { id: Id; contract: Contract }[];
  create(id: Id, contract: Contract): void;
  update(id: Id, contract: Contract): void;
}>

const sendMessage = (socket: WebSocket, message: unknown) => {
  console.log('outgoing message:', message);
  socket.send(JSON.stringify(message));
}

function stakeholders(contract: Contract): Set<Party> {
  const stakeholders = new Set<Party>();
  stakeholders.add(contract.proposer);
  stakeholders.add(contract.assignee);
  contract.reviewers.forEach(reviewer => stakeholders.add(reviewer));
  return stakeholders;
}

function updateContract(contract: Contract, sender: Party, message: UpdateMessage): true {
  const assertState = (state: ContractState) => {
    if (contract.state !== state) {
      throw Error(`message ${message.type} not allowed in state ${contract.state}`);
    }
  };
  const assertSender = (condition: boolean) => {
    if (!condition) {
      throw Error(`sender '${sender}' of message ${message.type} not allowed on contract ${JSON.stringify(contract)}`)
    }
  }

  switch (message.type) {
    case "accept": {
      assertState("PROPOSED");
      const senderIndex = contract.missingAcceptances.indexOf(sender);
      assertSender(senderIndex !== -1);
      contract.missingAcceptances.splice(senderIndex, 1);
      if (contract.missingAcceptances.length === 0) {
        contract.state = "ACCEPTED";
      }
      return true;
    }
    case "start": {
      assertState("ACCEPTED");
      assertSender(sender === contract.assignee);
      contract.state = "IN_PROGRESS";
      return true;
    }
    case "finish": {
      assertState("IN_PROGRESS");
      assertSender(sender === contract.assignee);
      contract.state = "IN_REVIEW";
      const missingApprovals = new Set<Party>();
      contract.reviewers.forEach(reviewer => missingApprovals.add(reviewer));
      missingApprovals.delete(sender);
      contract.missingApprovals = [...missingApprovals];
      return true;
    }
    case "reject": {
      assertState("IN_REVIEW");
      const reviewerIndex = contract.reviewers.indexOf(sender);
      assertSender(reviewerIndex !== -1);
      contract.state = "IN_PROGRESS";
      contract.comments.push(message.comment);
      contract.missingApprovals = [];
      return true;
    }
    case "approve": {
      assertState("IN_REVIEW");
      const reviewerIndex = contract.missingApprovals.indexOf(sender);
      assertSender(reviewerIndex !== -1);
      contract.missingApprovals.splice(reviewerIndex, 1);
      if (contract.missingApprovals.length === 0) {
        contract.state = "DONE";
      }
      return true;
    }
  }
}

function updateLedger(ledger: Ledger, persist: boolean, sender: Party, message: Message): Contract {
  const id = message.id;
  if (message.type === "propose") {
    if (!id.startsWith(sender)) {
      throw Error(`id ${id} does not start with sender '${sender}'`);
    }
    if (sender !== message.proposer) {
      throw Error(`sender '${sender} is not proposer '${message.proposer}'`);
    }
    if (ledger.fetch(id) !== undefined) {
      throw Error(`duplicate id ${id}`);
    }
    const contract: Contract = {
      state: "PROPOSED",
      description: message.description,
      proposer: message.proposer,
      assignee: message.assignee,
      reviewers: message.reviewers,
      comments: [],
      missingAcceptances: [],
      missingApprovals: [],
    }
    const missingAcceptances = stakeholders(contract);
    missingAcceptances.delete(sender);
    contract.missingAcceptances = [...missingAcceptances];
    if (persist) {
      ledger.create(id, contract);
    }
    return contract;
  } else {
    const contract = ledger.fetch(id);
    if (contract === undefined) {
      throw Error(`id ${id} does not exist`);
    }
    updateContract(contract, sender, message);
    if (persist) {
      ledger.update(id, contract);
    }
    return contract;
  }
}

function handleMessage(ledger: Ledger, rawMessage: unknown) {
  try {
    const { sender, payload: message } = jtv.object({
      sender: partyDecoder(),
      payload: messageDecoder(),
    }).runWithException(rawMessage);
    updateLedger(ledger, true, sender, message);
  } catch (error) {
    console.error('failed to handle message', rawMessage, error);
  }
}

function handleCommand(ledger: Ledger, socket: WebSocket, participant: Party, command: Command) {
  let id: Id;
  let message: Message;
  if (command.type === "propose") {
    id = idDecoder().runWithException(`${participant}-${uuidV4()}`);
    message = { ...command, id, proposer: participant };
  } else {
    message = { ...command };
  }
  const contract = updateLedger(ledger, false, participant, message);
  sendMessage(socket, {
    sender: participant,
    receivers: [...stakeholders(contract)],
    payload: message
  });
}

function Ledger(dbfile: string): Ledger {
  const db = sqlite3(dbfile);
  process.on('exit', () => {
    db.close();
  });
  db.prepare("CREATE TABLE IF NOT EXISTS contracts (id TEXT NOT NULL PRIMARY KEY, contract TEXT NOT NULL)").run();

  const listStmt = db.prepare("SELECT id FROM contracts");
  const fetchStmt = db.prepare("SELECT contract FROM contracts WHERE id = :id");
  const fetchAllStmt = db.prepare("SELECT id, contract FROM contracts");
  const createStmt = db.prepare("INSERT INTO contracts (id, contract) VALUES (:id, json(:contract))");
  const updateStmt = db.prepare("UPDATE contracts SET contract = :contract where id = :id");

  const list = () => {
    return listStmt.all().map(row => idDecoder().runWithException(row.id));
  };
  const fetch = (id: Id) => {
    const row = fetchStmt.get({ id });
    return row === undefined ? undefined : contractDecoder().runWithException(JSON.parse(row.contract));
  };
  const fetchAll = () => {
    return fetchAllStmt.all().map(row => ({
      id: idDecoder().runWithException(row.id),
      contract: contractDecoder().runWithException(JSON.parse(row.contract)),
    }));
  }
  const create = (id: Id, contract: Contract) => {
    createStmt.run({ id, contract: JSON.stringify(contract) })
  };
  const update = (id: Id, contract: Contract) => {
    updateStmt.run({ id, contract: JSON.stringify(contract) });
  };

  return { list, fetch, fetchAll, create, update };
}

type Args = {
  name: string;
  database?: string;
  clean?: boolean;
  port: number;
  router: string;
}

const args: Args = yargs
  .usage('start a qanban-node')
  .version(false)
  .options({
    name: {
      type: "string",
      alias: 'n',
      description: 'Name of the participant',
      demandOption: true,
    },
    database: {
      type: "string",
      alias: 'd',
      description: 'Path to the SQLite3 database',
    },
    clean: {
      type: "boolean",
      alias: 'c',
      description: 'Clean the database before starting',
    },
    port: {
      alias: 'p',
      description: 'Port of the web frontend',
      default: 3000,
    },
    router: {
      alias: 'r',
      description: 'Address of the router',
      default: 'localhost:7475',
    },
  })
  .demandCommand(0, 0, '', 'Positional arguments are not allowed')
  .strict()
  .argv;

const participant = partyDecoder().runWithException(args.name);
const uiPort = args.port;
const routerHost = args.router;
let database: string;
if (args.database === undefined) {
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  const qanbanHome = path.join(configHome, 'qanban');
  fs.mkdirSync(qanbanHome, {recursive: true});
  database = path.join(qanbanHome, `${participant}.db`);
  console.log(`database path: ${database}`);
} else {
  database = args.database;
}
if (args.clean) {
  fs.unlinkSync(database);
}

const ledger = Ledger(database);

const socket = new WebSocket(`ws://${routerHost}`);

socket.on('open', () => {
  console.log('connected to router');
  socket.on('ping', () => socket.pong());
  socket.on('message', rawMessage => {
      const json = JSON.parse(rawMessage.toString());
      console.log('incoming message:', json);
      handleMessage(ledger, json);
  });
  socket.on('close', () => {
    process.exit(1);
  });
  sendMessage(socket, { login: participant });
});

const app = express();
app.use(express.static('ui/build'));
app.use(express.json());

app.get('/api/whoami', (_req, res) => {
  res.status(200).contentType('text').send(participant);
})

app.get('/api/query', (_req, res) => {
  try {
    const contracts = ledger.fetchAll();
    res.status(200).send(contracts);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post('/api/command', (req, res) => {
  try {
    console.log('incoming command:', req.body);
    const command = commandDecoder().runWithException(req.body);
    handleCommand(ledger, socket, participant, command);
    res.status(200).send({ success: true });
  } catch (error) {
    res.status(500).send({
      success: false,
      error,
    });
  }
});

app.listen(uiPort, () => {
  console.log('api server up and running');
});
