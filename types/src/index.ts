import * as jtv from '@mojotech/json-type-validation';

declare global {
  interface JSON {
    parse(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown;
  }
  interface Body {
    json(): Promise<unknown>;
  }
}

const IdTag: unique symbol = Symbol();
const PartyTag: unique symbol = Symbol();

export type Id = string & {[IdTag]: never}
export type Party = string & {[PartyTag]: never}

export type ContractState = "PROPOSED" | "ACCEPTED" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";

export type Contract = {
  state: ContractState;
  description: string;
  proposer: Party;
  assignee: Party;
  reviewers: Party[];
  comments: string[];
  missingAcceptances: Party[];
  missingApprovals: Party[];
}

export type CreateCommand = {
  type: "propose";
  description: string;
  assignee: Party;
  reviewers: Party[];
}

export type CreateMessage = CreateCommand & { proposer: Party }

export type UpdateMessage =
  | { type: "accept" }
  | { type: "start" }
  | { type: "finish" }
  | { type: "reject"; comment: string }
  | { type: "approve" }

export type UpdateCommand = UpdateMessage & { id: Id }

export type Message = CreateMessage | UpdateMessage

export type Command = CreateCommand | UpdateCommand

export const allContractStates: ContractState[] =
  ["PROPOSED", "ACCEPTED", "IN_PROGRESS", "IN_REVIEW", "DONE"];

function merge<A extends object, B extends object>(
  aDecoder: jtv.Decoder<A>,
  bDecoder: jtv.Decoder<B>,
): jtv.Decoder<A & B> {
  return aDecoder.andThen(a => bDecoder.map(b => ({...a, ...b})));
}

export const idDecoder = (): jtv.Decoder<Id> =>
jtv.string().where(s => /[a-z][a-z0-9]*-[0-9a-f-]+/.test(s), 'expected an id').map(s => s as Id);

export const partyDecoder = (): jtv.Decoder<Party> =>
  jtv.string().where(s => /[a-z][a-z0-9]*/.test(s), 'expected a party').map(s => s as Party);

export const contractDecoder = () => jtv.object({
  state: jtv.oneOf<ContractState>(...allContractStates.map(state => jtv.constant(state))),
  description: jtv.string(),
  proposer: partyDecoder(),
  assignee: partyDecoder(),
  reviewers: jtv.array(partyDecoder()),
  comments: jtv.array(jtv.string()),
  missingAcceptances: jtv.array(partyDecoder()),
  missingApprovals: jtv.array(partyDecoder()),
});

export const createCommandDecoder = (): jtv.Decoder<CreateCommand> => jtv.object({
  type: jtv.constant("propose"),
  description: jtv.string(),
  assignee: partyDecoder(),
  reviewers: jtv.array(partyDecoder()),
});

export const createMessageDecoder = (): jtv.Decoder<CreateMessage> => merge(
  createCommandDecoder(),
  jtv.object({proposer: partyDecoder()}),
);

export const updateMessageDecoder = () => jtv.oneOf<UpdateMessage>(
  jtv.object({type: jtv.constant("accept")}),
  jtv.object({type: jtv.constant("start")}),
  jtv.object({type: jtv.constant("finish")}),
  jtv.object({
    type: jtv.constant("reject"),
    comment: jtv.string(),
  }),
  jtv.object({type: jtv.constant("approve")}),
);

export const updateCommandDecoder = (): jtv.Decoder<UpdateCommand> => merge(
  updateMessageDecoder(),
  jtv.object({id: idDecoder()}),
);

export const messageDecoder = () => jtv.oneOf<Message>(
  createMessageDecoder(),
  updateMessageDecoder(),
);

export const commandDecoder = () => jtv.oneOf<Command>(
  createCommandDecoder(),
  updateCommandDecoder(),
);

export function stakeholders(contract: Contract): Set<Party> {
  const stakeholders = new Set<Party>();
  stakeholders.add(contract.proposer);
  stakeholders.add(contract.assignee);
  contract.reviewers.forEach(reviewer => stakeholders.add(reviewer));
  return stakeholders;
}
