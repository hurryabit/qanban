import WebSocket from 'ws';
import http from 'http';
import url from 'url';
import * as jtv from '@mojotech/json-type-validation';
import Redis from 'ioredis';

type LoginMessage = {
  login: string;
}

type ProperMessage = {
  sender: string;
  receivers: string[];
  payload: unknown;
}

const PING_INTERVAL = 5_000;

const loginMessageDecoder = (): jtv.Decoder<LoginMessage> => jtv.object({
  login: jtv.string()
});

const properMessageDecoder = (): jtv.Decoder<ProperMessage> => jtv.object({
  sender: jtv.string(),
  receivers: jtv.array(jtv.string()),
  payload: jtv.unknownJson(),
});

const clients: { [client: string]: WebSocket | undefined } = {};

const port = Number.parseInt(process.env.PORT ?? "7475");
console.log(`binding qured-router to port ${port}`);

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const httpServer = http.createServer((_req, res) => {
  res.writeHead(302, {'Location': 'https://github.com/hurryabit/qanban#readme'}).end();
});
const wsServer = new WebSocket.Server({noServer: true});

wsServer.on('connection', (socket, initialMessage) => {
  console.log('new connection', initialMessage.headers);
  const address = JSON.stringify(initialMessage.headers);
  let participant: string | undefined = undefined;
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  socket.on('message', async data => {
    // FIXME(MH): This code is full of concurrency bugs. For instance:
    // (1) We share one Redis connection between all clients.
    // (2) If the client disconnects while still emptying the queue, the most
    //     recent message might get lost.
    // (3) If there is an incoming message right after the queue has been
    //     emptied, the message might end up in the queue but the client will
    //     ignore it and switch into live mode.
    try {
      const rawMessage = data.toString();
      const json = JSON.parse(rawMessage);
      if (participant === undefined) {
        const loginMessage = loginMessageDecoder().runWithException(json);
        participant = loginMessage.login;
        if (participant in clients) {
          throw Error(`User ${participant} is already connected.`);
        }
        clients[participant] = undefined;
        let queuedRawMessage;
        while ((queuedRawMessage = await redis.rpop(`queue:${participant}`)) !== null) {
          console.log(`redis: ${queuedRawMessage}`);
          socket.send(queuedRawMessage);
        }
        clients[participant] = socket;
      } else {
        const properMessage = properMessageDecoder().runWithException(json);
        if (properMessage.sender !== participant) {
          throw Error(`Sender ${properMessage.sender} does not match participant ${participant}.`);
        }
        for (const receiver of properMessage.receivers) {
          const client = clients[receiver];
          if (client === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            redis.lpush(`queue:${receiver}`, rawMessage);
          } else {
            client.send(rawMessage);
          }
        }
      }
    } catch (error) {
      socket.send(JSON.stringify({error: error.toString()}));
      socket.terminate();
    }
  });
  socket.on('error', error => {
    console.error(`error on connection from ${address}: ${error}`);
  });
  const pingInterval = setInterval(() => socket.ping(), PING_INTERVAL);
  socket.on('close', () => {
    clearInterval(pingInterval);
    if (participant !== undefined) {
      delete clients[participant];
    }
    console.log(`disconnect from ${address}`);
  });
});

httpServer.on('upgrade', function upgrade(request, socket, head) {
  const pathname = url.parse(request.url).pathname;

  if (pathname === '/') {
    wsServer.handleUpgrade(request, socket, head, ws => {
      wsServer.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

httpServer.listen({port}, () => {
  console.log('qured-router up and running');
});
