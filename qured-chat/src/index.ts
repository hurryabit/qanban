import * as jtv from '@mojotech/json-type-validation';
import WebSocket from 'ws';
import yargs from 'yargs';
import readline from 'readline';

const sendMessage = (socket: WebSocket, message: unknown) => {
  // console.log('outgoing message:', message);
  socket.send(JSON.stringify(message));
}

function handleMessage(rawMessage: unknown) {
  try {
    const { sender, receivers, payload } = jtv.object({
      sender: jtv.string(),
      receivers: jtv.array(jtv.string()),
      payload: jtv.string(),
    }).runWithException(rawMessage);
    console.log(`@${sender} => ${receivers.map(receiver => `@${receiver}`).join(' ')}: ${payload}`);
  } catch (error) {
    console.error('failed to handle message', rawMessage, error);
  }
}

type Args = {
  name: string;
  router: string;
}

const args: Args = yargs
  .usage('start the qanban-chat')
  .version(false)
  .options({
    name: {
      type: "string",
      alias: 'n',
      description: 'Name of the participant',
      demandOption: true,
    },
    router: {
      alias: 'r',
      description: 'Address of the router',
      default: 'localhost:7475',
    },
  })
  .demandCommand(0, 0, '', 'Positional arguments are not allowed')
  .strict()
  .argv;

const socket = new WebSocket(`ws://${args.router}`);

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function output(printer: () => void) {
  terminal.pause();
  readline.clearLine(process.stdin, 0);
  readline.cursorTo(process.stdin, 0);
  printer();
  terminal.prompt(true);
}

socket.on('open', () => {
  console.log('connected to router');
  socket.on('ping', () => socket.pong());
  socket.on('message', rawMessage => output(() => {
    const json = JSON.parse(rawMessage.toString());
    // console.log('incoming message:', json);
    handleMessage(json);
  }));
  socket.on('close', () => {
    process.exit(1);
  });
  sendMessage(socket, { login: args.name });
  terminal.prompt(true);
});

terminal.on('line', line => {
  const receivers: string[] = [];
  while (line.startsWith('@')) {
    const spaceIndex = line.indexOf(' ');
    if (spaceIndex === -1) {
      receivers.push(line.slice(1));
      line = '';
    } else {
      receivers.push(line.slice(1, spaceIndex));
      line = line.slice(spaceIndex).trimLeft();
    }
  }
  output(() => {
    sendMessage(socket, {sender: args.name, receivers, payload: line});
  });
});
