import WebSocket from 'ws';
import http from 'http';
import url from 'url';
import * as jtv from '@mojotech/json-type-validation';

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

const clients: {[client: string]: WebSocket | ProperMessage[]} = {};

function sendMessage(socket: WebSocket, message: unknown) {
  socket.send(JSON.stringify(message));
}

const port = Number.parseInt(process.env.PORT ?? "7475");
console.log(`binding router to port ${port}`);

const httpServer = http.createServer((_req, res) => {
  res.writeHead(302, {'Location': 'https://github.com/hurryabit/qanban#readme'}).end();
});
const wsServer = new WebSocket.Server({noServer: true});

wsServer.on('connection', (socket, initialMessage) => {
  console.log('new connection', initialMessage.headers);
  const address = JSON.stringify(initialMessage.headers);
  let participant: string | undefined = undefined;
  socket.on('message', rawMessage => {
    try {
      const json = JSON.parse(rawMessage.toString());
      if (participant === undefined) {
        const loginMessage = loginMessageDecoder().runWithException(json);
        participant = loginMessage.login;
        if (participant in clients) {
          const client = clients[participant];
          if (client instanceof WebSocket) {
            throw Error(`User ${participant} is already connected.`);
          }
          while (client.length > 0) {
            sendMessage(socket, client.shift());
          }
        }
        clients[participant] = socket;
      } else {
        const properMessage = properMessageDecoder().runWithException(json);
        if (properMessage.sender !== participant) {
          throw Error(`Sender ${properMessage.sender} does not match participant ${participant}.`);
        }
        for (const receiver of properMessage.receivers) {
          if (!(receiver in clients)) {
            clients[receiver] = [];
          }
          const receiverClient = clients[receiver];
          if (receiverClient instanceof WebSocket) {
            sendMessage(receiverClient, properMessage);
          } else {
            receiverClient.push(properMessage);
          }
        }
      }
    } catch (error) {
      sendMessage(socket, {error: error.toString()});
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
      clients[participant] = [];
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
  console.log('router up and running');
});
