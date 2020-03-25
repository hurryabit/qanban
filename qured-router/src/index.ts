import WebSocket from 'ws';
import http from 'http';
import liburl from 'url';
import * as jtv from '@mojotech/json-type-validation';
import Redis from 'ioredis';
import { Message, PartyId } from 'qured-protocol';

type LoginMessage = {
  login: PartyId;
}

const LoginMessage = {
  decoder: (): jtv.Decoder<LoginMessage> => jtv.object({
    login: PartyId.decoder(),
  }),
}

const PING_INTERVAL = 5_000;

const apps: { [appName: string]: { [login: string]: WebSocket | undefined } } = {};

const port = Number.parseInt(process.env.PORT ?? "7475");
console.log(`binding qured-router to port ${port}`);

function getAppName(url: string): string | undefined {
  const pathname = liburl.parse(url).pathname;
  if (pathname === null || !/^\/[A-Za-z0-9-]{4,32}$/.test(pathname)) {
    return undefined;
  }
  return pathname.slice(1);
}

function queueKey(config: {appName: string; party: PartyId}): string {
  return `queue:${config.appName}:${config.party}`;
}

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const httpServer = http.createServer((_req, res) => {
  res.writeHead(302, {'Location': 'https://github.com/hurryabit/qanban#readme'}).end();
});
const wsServer = new WebSocket.Server({noServer: true});

wsServer.on('connection', (socket, initialMessage) => {
  if (initialMessage.url === undefined) {
    throw Error('new connction without url');
  }
  const appName = getAppName(initialMessage.url);
  if (appName === undefined) {
    throw Error(`new connection with invalid url ${initialMessage.url}`);
  }
  console.log(`new connection with ${appName}`, initialMessage.headers);
  if (!(appName in apps)) {
    apps[appName] = {};
  }
  const clients = apps[appName];
  const address = JSON.stringify(initialMessage.headers);
  let participant: PartyId | undefined = undefined;
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
        const loginMessage = LoginMessage.decoder().runWithException(json);
        participant = loginMessage.login;
        if (participant in clients) {
          throw Error(`User ${participant} is already connected.`);
        }
        clients[participant] = undefined;
        let queuedRawMessage;
        while ((queuedRawMessage = await redis.rpop(queueKey({appName, party: participant}))) !== null) {
          console.log(`redis: ${queuedRawMessage}`);
          socket.send(queuedRawMessage);
        }
        clients[participant] = socket;
      } else {
        const properMessage = Message.decoder(jtv.unknownJson()).runWithException(json);
        if (properMessage.sender !== participant) {
          throw Error(`Sender ${properMessage.sender} does not match participant ${participant}.`);
        }
        for (const receiver of properMessage.receivers) {
          const client = clients[receiver];
          if (client === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            redis.lpush(queueKey({appName, party: receiver}), rawMessage);
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
  if (getAppName(request.url) !== undefined) {
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
