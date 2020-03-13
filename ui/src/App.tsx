import React, { useState, useEffect, useCallback } from 'react';
import { Grid, Container, Header } from 'semantic-ui-react';
import { Id, Contract, idDecoder, contractDecoder, allContractStates, partyDecoder, Party } from 'qanban-types';
import * as jtv from '@mojotech/json-type-validation';
import Column from './Column';

const App: React.FC = () => {
  const [participant, setParticipant] = useState<Party | undefined>();
  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/whoami', {
        method: "GET",
      });
      if (res.ok) {
        const text = await res.text();
        const participant = partyDecoder().runWithException(text);
        setParticipant(participant);
      } else {
        console.error(`whoami failed with status ${res.status}:`, res.body);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    load();
  }, []);

  const [contracts, setContracts] = useState<{ id: Id; contract: Contract }[]>([]);
  const [reloadCount, setReloadCount] = useState(0);
  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/query', {
        method: "GET",
      });
      if (res.ok) {
        const json = await res.json();
        const contracts = jtv.array(jtv.object({
          id: idDecoder(),
          contract: contractDecoder(),
        })).runWithException(json);
        setContracts(contracts);
      } else {
        console.error(`query failed with status ${res.status}:`, res.body);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    load();
  }, [reloadCount]);
  const reload = useCallback(() => setReloadCount(count => count+1), []);
  useEffect(() => {
    const intervalId = setInterval(reload, 1000);
    console.log('started internval');
    return () => {
      console.log('cleared interval');
      clearInterval(intervalId);
    }
  }, [reload]);


  return (
    <Container>
      <Header
        id="qanban-title"
        as="h1"
        size="huge"
        textAlign="center"
      >
        {participant  ?? '???'}'s Qanban Board
      </Header>
      <Grid columns="5" divided>
        {allContractStates.map(state => (
          <Column
            key={state}
            participant={participant}
            state={state}
            contracts={contracts}
            reload={reload}
          />
        ))}
      </Grid>
    </Container>
  );
}

export default App;
