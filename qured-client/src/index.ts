import * as jtv from '@mojotech/json-type-validation';
import Emittery from 'emittery';
import WebSocket from 'ws';

export type Config<Payload, Party extends string = string> = {
  readonly router: string;
  readonly login: Party;
  readonly partyDecoder?: jtv.Decoder<Party>;
  readonly payloadDecoder?: jtv.Decoder<Payload>;
} & (string extends Party ? {} : { readonly partyDecoder: jtv.Decoder<Party> })
// NOTE(MH): The purpose of the intersection with the conditional type is to
// make `partyDecoder` non-optional when `Party` is _not_ `string`.

export type Message<Payload, Party extends string = string> = {
  sender: Party;
  receivers: Party[];
  payload: Payload;
}

export type Events<Payload, Party extends string = string> = {
  message: Message<Payload, Party>;
  error: unknown;
  close: number;
}

export type EmptyEvents = "open"

export default class QuredClient<Payload, Party extends string = string> extends Emittery.Typed<Events<Payload, Party>, EmptyEvents> {
  private socket: WebSocket;
  private login: Party;
  private messageDecoder: jtv.Decoder<Message<Payload, Party>>;

  constructor(config: Config<Payload, Party>) {
    super();
    const socket = new WebSocket(config.router);
    this.socket = socket;
    this.login = config.login;
    const partyDecoder = config.partyDecoder ?? jtv.string().map(party => party as Party);
    this.messageDecoder = jtv.object({
      sender: partyDecoder,
      receivers: jtv.array(partyDecoder),
      payload: config.payloadDecoder ?? jtv.anyJson(),
    });
    socket.on("open", () => {
      socket.on("ping", () => socket.pong());
      socket.on("message", rawMessage => {
        try {
          const json = JSON.parse(rawMessage.toString());
          console.log('incoming message:', json);
          const message: Message<Payload, Party> = this.messageDecoder.runWithException(json);
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.emit("message", message);
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.emit("error", error);
        }
      });
      socket.on("error", error => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.emit("error", error);
      })
      socket.on("close", code => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.emit("close", code);
      });
      socket.send(JSON.stringify({ login: config.login }));
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.emit("open");
    });
  }

  send(message: Message<Payload, Party>): void {
    if (message.sender !== this.login) {
      throw Error(`sender '${message.sender}' of message does not match login '${this.login}'`);
    }
    const json = this.messageDecoder.runWithException(message);
    console.log('outgoing message:', json);
    this.socket.send(JSON.stringify(json));
  }

  close(): void {
    this.socket.close();
  }
}
