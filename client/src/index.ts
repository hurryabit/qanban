import * as jtv from '@mojotech/json-type-validation';
import net from 'net';
import readline from 'readline';
import sqlite3 from 'better-sqlite3';
import { v4 as uuidV4 } from 'uuid';

const IdTag: unique symbol = Symbol();
const PartyTag: unique symbol = Symbol();

type Id = string & {[IdTag]: never}
type Party = string & {[PartyTag]: never}

type ContractState = "PROPOSED" | "ACCEPTED" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";

type Contract = {
  state: ContractState;
  description: string;
  proposer: Party;
  assignee: Party;
  reviewers: Party[];
  comments: string[];
  missingAcceptances: Party[];
  missingApprovals: Party[];
}

type CreateMessage =
  | {
      type: "propose";
      description: string;
      proposer: Party;
      assignee: Party;
      reviewers: Party[];
    }

type UpdateMessage =
  | { type: "accept" }
  | { type: "start" }
  | { type: "finish" }
  | { type: "reject"; comment: string }
  | { type: "approve" }

type Message = CreateMessage | UpdateMessage

type Ledger = Readonly<{
  list(): Id[];
  fetch(id: Id): Contract | undefined;
  create(id: Id, contract: Contract): void;
  update(id: Id, contract: Contract): void;
}>

const allContractStates: ContractState[] =
  ["PROPOSED", "ACCEPTED", "IN_PROGRESS", "IN_REVIEW", "DONE"];

const idDecoder = (): jtv.Decoder<Id> =>
jtv.string().where(s => /[a-z][a-z0-9]*-[0-9a-f-]+/.test(s), 'expected an id').map(s => s as Id);

const partyDecoder = (): jtv.Decoder<Party> =>
  jtv.string().where(s => /[a-z][a-z0-9]*/.test(s), 'expected a party').map(s => s as Party);


const withIdDecoder = () => jtv.object({id: idDecoder()}).map(message => message.id);

const contractDecoder = () => jtv.object({
  state: jtv.oneOf<ContractState>(...allContractStates.map(state => jtv.constant(state))),
  description: jtv.string(),
  proposer: partyDecoder(),
  assignee: partyDecoder(),
  reviewers: jtv.array(partyDecoder()),
  comments: jtv.array(jtv.string()),
  missingAcceptances: jtv.array(partyDecoder()),
  missingApprovals: jtv.array(partyDecoder()),
});

const messageDecoder = () => jtv.oneOf<Message>(
  jtv.object({
    type: jtv.constant("propose"),
    description: jtv.string(),
    proposer: partyDecoder(),
    assignee: partyDecoder(),
    reviewers: jtv.array(partyDecoder()),
  }),
  jtv.object({type: jtv.constant("accept")}),
  jtv.object({type: jtv.constant("start")}),
  jtv.object({type: jtv.constant("finish")}),
  jtv.object({
    type: jtv.constant("reject"),
    comment: jtv.string(),
  }),
  jtv.object({type: jtv.constant("approve")}),
);

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

function handleMessage(ledger: Ledger, data: Buffer) {
  try {
    const rawMessage = JSON.parse(data.toString());
    const {id, sender, message} = jtv.object({
      id: idDecoder(),
      sender: partyDecoder(),
      message: messageDecoder(),
    }).runWithException(rawMessage);
    updateLedger(ledger, id, sender, message);
  } catch (error) {
    console.error('failed to handle message', data, error);
  }
}

function handleCommand(ledger: Ledger, socket: net.Socket, participant: Party, rawCommand: unknown) {
  const message = messageDecoder().runWithException(rawCommand);
  let id: Id;
  if (message.type === "propose") {
    id = idDecoder().runWithException(`${participant}-${uuidV4()}`);
  } else {
    id = withIdDecoder().runWithException(rawCommand);
  }
  const contract = updateLedger(ledger, id, participant, message);
  const receivers = stakeholders(contract);
  receivers.delete(participant);
  receivers.forEach(receiver => {
    sendMessage(socket, {receiver, id, message});
  });
}

function handleInput(ledger: Ledger, socket: net.Socket, participant: Party, input: string) {
  try {
    if (input === 'list') {
      console.log('ids of all contracts:')
      ledger.list().forEach(id => console.log(`- ${id}`));
    } else if (input.startsWith('fetch ')) {
      const id = idDecoder().runWithException(input.slice(6).trim());
      const contract = ledger.fetch(id);
      if (contract === undefined) {
        throw Error(`unknown id ${id}`);
      }
      console.log(JSON.stringify(contract, undefined, 2));
    } else if (input.startsWith('command ')) {
      handleCommand(ledger, socket, participant, JSON.parse(input.slice(8)));
    } else {
      throw Error(`bad input: ${input}`);
    }
  } catch (error) {
    console.error('failed to handle input', input, error);
  }
}

function Ledger(dbfile: string): Ledger {
  const db = sqlite3(dbfile);
  process.on('exit', () => {
    db.close();
  });
  db.prepare("CREATE TABLE IF NOT EXISTS contracts (id TEXT NOT NULL PRIMARY KEY, contract TEXT NOT NULL)").run();

  const listStmt = db.prepare("SELECT id FROM contracts");
  const fetchStmt = db.prepare("SELECT contract FROM contracts WHERE id = :id");
  const createStmt = db.prepare("INSERT INTO contracts (id, contract) VALUES (:id, json(:contract))");
  const updateStmt = db.prepare("UPDATE contracts SET contract = :contract where id = :id");

  const list = () => {
    return listStmt.all().map(row => row.id);
  };
  const fetch = (id: Id) => {
    const row = fetchStmt.get({id});
    return row === undefined ? undefined : contractDecoder().runWithException(JSON.parse(row.contract));
  };
  const create = (id: Id, contract: Contract) => {
    createStmt.run({id, contract: JSON.stringify(contract)})
  };
  const update = (id: Id, contract: Contract) => {
    updateStmt.run({id, contract: JSON.stringify(contract)});
  };

  return {list, fetch, create, update};
}

const participant = partyDecoder().runWithException(process.argv[2]);
const dbfile = process.argv[3];

const ledger = Ledger(dbfile);

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const socket = net.createConnection({port: 7475});

terminal.on('line', input => {
  // console.log(`input: ${input}`);
  handleInput(ledger, socket, participant, input);
  terminal.prompt();
});

socket.on('connect', () => {
  console.log('connected');
  socket.on('data', data => {
    terminal.pause();
    // console.log(`message: ${data}`);
    handleMessage(ledger, data);
    terminal.resume();
  });
  socket.on('close', hadError => {
    process.exit(hadError ? 1 : 0);
  });
  sendMessage(socket, {login: participant});
  terminal.prompt();
});
