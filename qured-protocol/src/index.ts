import * as jtv from '@mojotech/json-type-validation';

declare global {
  interface JSON {
    parse(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown;
  }
  interface Body {
    json(): Promise<unknown>;
  }
}

const PartyIdTag: unique symbol = Symbol("PartyIdTag");

export type PartyId = string & { [PartyIdTag]: undefined }

export type Message<Payload> = {
  sender: PartyId;
  receivers: PartyId[];
  payload: Payload;
}

export function PartyId(partyId: string): PartyId {
  if (!PartyId.regex.test(partyId)) {
    throw Error(`'${partyId} is not a valid party identifier`);
  }
  return partyId as PartyId;
}
PartyId.regex = /[A-Za-z][A-Za-z0-9]*/;
PartyId.decoder = (): jtv.Decoder<PartyId> =>
  jtv.string().where(s => PartyId.regex.test(s), 'expected a party identifier').map(s => s as PartyId);

export const Message = {
  decoder: <Payload>(payloadDecoder: jtv.Decoder<Payload>): jtv.Decoder<Message<Payload>> =>
    jtv.object({
      sender: PartyId.decoder(),
      receivers: jtv.array(PartyId.decoder()),
      payload: payloadDecoder,
    }),
} as const;
