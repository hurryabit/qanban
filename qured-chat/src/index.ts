import * as jtv from '@mojotech/json-type-validation';
import readline from 'readline';
import yargs from 'yargs';
import QuredClient, { PartyId } from 'qured-client';

type Args = {
  name: string;
  router: string;
}

const args: Args = yargs
  .usage('start the qured-chat')
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

const client = new QuredClient<string>({
  router: `ws://${args.router}`,
  login: PartyId(args.name),
  payloadDecoder: jtv.string(),
});

client.on("open", () => {
  console.log(`connected to ${args.router}`);
  terminal.prompt();
});
client.on("message", ({sender, receivers, payload}) => output(() => {
  const line = `@${sender} => ${receivers.map(receiver => `@${receiver}`).join(' ')}: ${payload}`;
  console.log(line);
}));
client.on("error", error => output(() => {
  const line = error instanceof Error ? error.toString() : JSON.stringify(error);
  console.error(`ERROR: ${line}`);
}));
client.on("close", code => output(() => {
  console.log(`ERROR: connection closed by router with code ${code}`);
}));


terminal.on('line', line => {
  const receivers: PartyId[] = [];
  while (line.startsWith('@')) {
    const spaceIndex = line.indexOf(' ');
    if (spaceIndex === -1) {
      receivers.push(PartyId(line.slice(1)));
      line = '';
    } else {
      receivers.push(PartyId(line.slice(1, spaceIndex)));
      line = line.slice(spaceIndex).trimLeft();
    }
  }
  client.send({sender: PartyId(args.name), receivers, payload: line});
});
