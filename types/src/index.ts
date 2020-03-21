import * as jtv from '@mojotech/json-type-validation';
import { PartyId } from 'qured-protocol';

export { PartyId } from 'qured-protocol';

const IdTag: unique symbol = Symbol();

export type Id = string & {[IdTag]: never}

export type ContractState = "PROPOSED" | "ACCEPTED" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";

export type Contract = {
  state: ContractState;
  description: string;
  proposer: PartyId;
  assignee: PartyId;
  reviewers: PartyId[];
  comments: string[];
  missingAcceptances: PartyId[];
  missingApprovals: PartyId[];
}

export type CreateMessage = {
  id: Id;
  type: "propose";
  description: string;
  proposer: PartyId;
  assignee: PartyId;
  reviewers: PartyId[];
}

export type CreateCommand = Omit<CreateMessage, "id" | "proposer">

export type UpdateMessage =
  | { id: Id; type: "accept" }
  | { id: Id; type: "start" }
  | { id: Id; type: "finish" }
  | { id: Id; type: "reject"; comment: string }
  | { id: Id; type: "approve" }

export type Message = CreateMessage | UpdateMessage

export type Command = CreateCommand | UpdateMessage

export const allContractStates: ContractState[] =
  ["PROPOSED", "ACCEPTED", "IN_PROGRESS", "IN_REVIEW", "DONE"];

function merge<A extends object, B extends object>(
  aDecoder: jtv.Decoder<A>,
  bDecoder: jtv.Decoder<B>,
): jtv.Decoder<A & B> {
  return aDecoder.andThen(a => bDecoder.map(b => ({...a, ...b})));
}

export const idDecoder = (): jtv.Decoder<Id> =>
jtv.string().where(s => /[A-Za-z][A-Za-z0-9]*-[0-9a-f-]+/.test(s), 'expected an id').map(s => s as Id);

export const contractDecoder = () => jtv.object({
  state: jtv.oneOf<ContractState>(...allContractStates.map(state => jtv.constant(state))),
  description: jtv.string(),
  proposer: PartyId.decoder(),
  assignee: PartyId.decoder(),
  reviewers: jtv.array(PartyId.decoder()),
  comments: jtv.array(jtv.string()),
  missingAcceptances: jtv.array(PartyId.decoder()),
  missingApprovals: jtv.array(PartyId.decoder()),
});

export const createCommandDecoder = (): jtv.Decoder<CreateCommand> => jtv.object({
  type: jtv.constant("propose"),
  description: jtv.string(),
  assignee: PartyId.decoder(),
  reviewers: jtv.array(PartyId.decoder()),
});

export const createMessageDecoder = (): jtv.Decoder<CreateMessage> => merge(
  createCommandDecoder(),
  jtv.object({
    id: idDecoder(),
    proposer: PartyId.decoder()
  }),
);

export const updateMessageDecoder = () => jtv.oneOf<UpdateMessage>(
  jtv.object({id: idDecoder(), type: jtv.constant("accept")}),
  jtv.object({id: idDecoder(), type: jtv.constant("start")}),
  jtv.object({id: idDecoder(), type: jtv.constant("finish")}),
  jtv.object({
    id: idDecoder(),
    type: jtv.constant("reject"),
    comment: jtv.string(),
  }),
  jtv.object({id: idDecoder(), type: jtv.constant("approve")}),
);

export const messageDecoder = () => jtv.oneOf<Message>(
  createMessageDecoder(),
  updateMessageDecoder(),
);

export const commandDecoder = () => jtv.oneOf<Command>(
  createCommandDecoder(),
  updateMessageDecoder(),
);
