import * as jtv from '@mojotech/json-type-validation';
import Emittery from 'emittery';
import WebSocket from 'ws';
import { PartyId, Message } from 'qured-protocol';

export { PartyId, Message } from 'qured-protocol';

export type Config<Payload> = {
  readonly router: string;
  readonly login: PartyId;
  readonly payloadDecoder?: jtv.Decoder<Payload>;
}

export type Events<Payload> = {
  message: Message<Payload>;
  error: unknown;
  close: number;
}

export type EmptyEvents = "open"

export default class QuredClient<Payload> extends Emittery.Typed<Events<Payload>, EmptyEvents> {
  private socket: WebSocket;
  private login: PartyId;
  private messageDecoder: jtv.Decoder<Message<Payload>>;

  constructor(config: Config<Payload>) {
    super();
    const socket = new WebSocket(config.router);
    this.socket = socket;
    this.login = config.login;
    this.messageDecoder = Message.decoder(config.payloadDecoder ?? jtv.anyJson());
    socket.on("open", () => {
      socket.on("ping", () => socket.pong());
      socket.on("message", rawMessage => {
        try {
          const json = JSON.parse(rawMessage.toString());
          console.log('incoming message:', json);
          const message: Message<Payload> = this.messageDecoder.runWithException(json);
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

  send(message: Message<Payload>): void {
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
