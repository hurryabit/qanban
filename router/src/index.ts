import net from 'net';

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

const clients: {[client: string]: net.Socket | MessageWithSender[]} = {};

const sendMessage = (socket: net.Socket, message: unknown) => {
  socket.write(JSON.stringify(message) + '\n');
}

const server = net.createServer(socket => {
  const address = `${socket.remoteAddress}:${socket.remotePort}`;
  let sender: string | undefined = undefined;
  console.log(`new connection from ${address}`);
  socket.on('data', datas => {
    for (const data of datas.toString().split('\n').filter(data => data !== '')) {
      try {
        const message = JSON.parse(data);
        if (sender === undefined) {
          assertIsLoginMessage(message);
          sender = message.login;
          if (sender in clients) {
            const client = clients[sender];
            if (client instanceof net.Socket) {
              throw Error(`User ${sender} is already connected.`);
            }
            while (client.length > 0) {
              sendMessage(socket, client.shift());
            }
          }
          clients[sender] = socket;
        } else {
          assertIsMessageWithReceiver(message);
          const receiver = message.receiver;
          if (!(receiver in clients)) {
            clients[receiver] = [];
          }
          const receiverClient = clients[receiver];
          delete message.receiver;
          message.sender = sender;
          if (receiverClient instanceof net.Socket) {
            sendMessage(receiverClient, message);
          } else {
            receiverClient.push(message as unknown as MessageWithSender);
          }
        }
      } catch (error) {
        sendMessage(socket, {error: error.toString()});
        socket.end();
      }
    }
  });
  socket.on('error', error => {
    console.error(`error on connection from ${address}: ${error}`);
  });
  socket.on('close', () => {
    if (sender !== undefined) {
      clients[sender] = [];
    }
    console.log(`disconnect from ${address}`);
  });
});

server.listen(7475, 'localhost', () => {
  console.log('router up and running');
});
