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

const clients: {[client: string]: {socket: WebSocket; pingInterval?: NodeJS.Timeout} | ProperMessage[]} = {};

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
  let sender: string | undefined = undefined;
  socket.on('message', rawMessage => {
    try {
      const json = JSON.parse(rawMessage.toString());
      if (sender === undefined) {
        const loginMessage = loginMessageDecoder().runWithException(json);
        sender = loginMessage.login;
        if (sender in clients) {
          const client = clients[sender];
          if ("socket" in client) {
            throw Error(`User ${sender} is already connected.`);
          }
          while (client.length > 0) {
            sendMessage(socket, client.shift());
          }
        }
        const pingInterval = setInterval(() => socket.ping(), PING_INTERVAL);
        clients[sender] = {socket, pingInterval};
      } else {
        const properMessage = properMessageDecoder().runWithException(json);
        if (properMessage.sender !== sender) {
          throw Error(`Sender ${properMessage.sender} does not match participant ${sender}.`);
        }
        for (const receiver of properMessage.receivers) {
          if (!(receiver in clients)) {
            clients[receiver] = [];
          }
          const receiverClient = clients[receiver];
          if ("socket" in receiverClient) {
            sendMessage(receiverClient.socket, properMessage);
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
  socket.on('close', () => {
    if (sender !== undefined) {
      const client = clients[sender];
      if ("pingInterval" in client && client.pingInterval !== undefined) {
        clearInterval(client.pingInterval);
      }
      clients[sender] = [];
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
