import * as jtv from '@mojotech/json-type-validation';
import Emittery from 'emittery';
import WebSocket from 'ws';

export type Config<Payload> = {
  router: string;
  login: string;
  payloadDecoder?: jtv.Decoder<Payload>;
}

export type Message<Payload> = {
  sender: string;
  receivers: string[];
  payload: Payload;
}

export type Events<Payload> = {
  message: Message<Payload>;
  error: unknown;
  close: number;
}

export type EmptyEvents = "open"

export default class QuredClient<Payload> extends Emittery.Typed<Events<Payload>, EmptyEvents> {
  private socket: WebSocket;
  private messageDecoder: jtv.Decoder<Message<Payload>>;

  constructor(config: Config<Payload>) {
    super();
    const socket = new WebSocket(config.router);
    this.socket = socket;
    this.messageDecoder = jtv.object({
      sender: jtv.string(),
      receivers: jtv.array(jtv.string()),
      payload: config.payloadDecoder ?? jtv.anyJson(),
    });
    socket.on("open", () => {
      socket.on("ping", () => socket.pong());
      socket.on("message", rawMessage => {
        try {
          console.log(`incoming message: ${rawMessage}`);
          const message: Message<Payload> =
            this.messageDecoder.runWithException(JSON.parse(rawMessage.toString()));
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
    const rawMessage = JSON.stringify(message);
    console.log(`outgoing message: ${rawMessage}`);
    this.socket.send(rawMessage);
  }

  close(): void {
    this.socket.close();
  }
}
