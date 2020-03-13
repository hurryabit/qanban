import * as jtv from '@mojotech/json-type-validation';
import sqlite3 from 'better-sqlite3';
import express from 'express';
import net from 'net';
import { Command, commandDecoder, Contract, contractDecoder, ContractState, Id, idDecoder, Message, messageDecoder, Party, partyDecoder, UpdateMessage } from 'qanban-types';
import { v4 as uuidV4 } from 'uuid';

type Ledger = Readonly<{
  list(): Id[];
  fetch(id: Id): Contract | undefined;
  fetchAll(): { id: Id; contract: Contract }[];
  create(id: Id, contract: Contract): void;
  update(id: Id, contract: Contract): void;
}>

const sendMessage = (socket: net.Socket, message: unknown) => {
  socket.write(JSON.stringify(message) + '\n');
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
      const reviewerIndex = contract.reviewers.indexOf(sender);
      assertSender(reviewerIndex !== -1);
      contract.missingApprovals.splice(reviewerIndex, 1);
      if (contract.missingApprovals.length === 0) {
        contract.state = "DONE";
      }
      return true;
    }
  }
}

function updateLedger(ledger: Ledger, id: Id, sender: Party, message: Message): Contract {
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
    ledger.create(id, contract);
    return contract;
  } else {
    const contract = ledger.fetch(id);
    if (contract === undefined) {
      throw Error(`id ${id} does not exist`);
    }
    updateContract(contract, sender, message);
    ledger.update(id, contract);
    return contract;
  }
}

function handleMessage(ledger: Ledger, rawMessage: unknown) {
  try {
    const { id, sender, message } = jtv.object({
      id: idDecoder(),
      sender: partyDecoder(),
      message: messageDecoder(),
    }).runWithException(rawMessage);
    updateLedger(ledger, id, sender, message);
  } catch (error) {
    console.error('failed to handle message', rawMessage, error);
  }
}

function handleCommand(ledger: Ledger, socket: net.Socket, participant: Party, command: Command) {
  let id: Id;
  let message: Message;
  if (command.type === "propose") {
    id = idDecoder().runWithException(`${participant}-${uuidV4()}`);
    message = { ...command, proposer: participant };
  } else {
    id = command.id;
    delete command.id;
    message = { ...command };
  }
  const contract = updateLedger(ledger, id, participant, message);
  const receivers = stakeholders(contract);
  receivers.delete(participant);
  receivers.forEach(receiver => {
    sendMessage(socket, { receiver, id, message });
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

const argv = process.argv;
if (argv.length !== 4) {
  console.error(`usage: ${argv[0]} ${argv[1]} <participant-name> <api-port>`);
  process.exit(1);
}

const participant = partyDecoder().runWithException(argv[2]);
const apiPort = Number.parseInt(argv[3]);

const ledger = Ledger(`${participant}.db`);

const socket = net.createConnection({ port: 7475 });

socket.on('connect', () => {
  console.log('connected to router');
  socket.on('data', data => {
    const json = JSON.parse(data.toString());
    console.log('incoming message:', json);
    handleMessage(ledger, json);
  });
  socket.on('close', hadError => {
    process.exit(hadError ? 1 : 0);
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

app.listen(apiPort, () => {
  console.log('api server up and running');
});
