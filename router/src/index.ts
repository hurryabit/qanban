import WebSocket from 'ws';

type LoginMessage = {
  login: string;
}

type MessageWithReceiver = {
  receiver: string;
  [_: string]: unknown;
}

type MessageWithSender = {
  sender: string;
  [_: string]: unknown;
}

const PING_INTERVAL = 5_000;

function assertIsLoginMessage (message: unknown): asserts message is LoginMessage {
  if (typeof message === "object" && message !== null) {
    const keys = Object.keys(message);
    if (keys.length === 1 && keys[0] === "login"
        && typeof (message as {login: unknown}).login === "string") {
      return;
    }
  }
  throw Error(`Expected login message, found ${JSON.stringify(message)}.`);
}

function assertIsMessageWithReceiver(message: unknown): asserts message is MessageWithReceiver {
  if (typeof message === "object" && message !== null && "receiver" in message
      && typeof (message as {receiver: unknown}).receiver === "string") {
    return;
  }
  throw Error(`Expected message with receiver, found ${JSON.stringify(message)}.`);
}

const clients: {[client: string]: {socket: WebSocket; pingInterval?: NodeJS.Timeout} | MessageWithSender[]} = {};

function sendMessage(socket: WebSocket, message: unknown) {
  socket.send(JSON.stringify(message));
}

const server = new WebSocket.Server({host: 'localhost', port: 7475});

server.on('listening', () => {
  console.log('router up and running');
})

server.on('connection', (socket, initialMessage) => {
  console.log('new connection', initialMessage.headers);
  const address = JSON.stringify(initialMessage.headers);
  let sender: string | undefined = undefined;
  socket.on('message', rawMessage => {
    try {
      const message = JSON.parse(rawMessage.toString());
      if (sender === undefined) {
        assertIsLoginMessage(message);
        sender = message.login;
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
        assertIsMessageWithReceiver(message);
        const receiver = message.receiver;
        if (!(receiver in clients)) {
          clients[receiver] = [];
        }
        const receiverClient = clients[receiver];
        delete message.receiver;
        message.sender = sender;
        if ("socket" in receiverClient) {
          sendMessage(receiverClient.socket, message);
        } else {
          receiverClient.push(message as unknown as MessageWithSender);
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
