import React, { useState, useEffect, useCallback } from 'react';
import { Grid, Container, Header, Button, Modal, Form } from 'semantic-ui-react';
import { Id, Contract, idDecoder, contractDecoder, allContractStates, partyDecoder, Party, CreateCommand, createCommandDecoder } from 'qanban-types';
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

  const [editingProposal, setEditingProposal] = useState(false);
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reviewers, setReviewers] = useState('');

  const handleSubmitProposal = async () => {
    const command: CreateCommand = createCommandDecoder().runWithException({
      type: "propose",
      description,
      assignee,
      reviewers: reviewers.split(',').map(reviewer => reviewer.trim()),
    });
    const res = await fetch('/api/command', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (res.ok) {
      setEditingProposal(false);
      reload();
    } else {
      console.error(`command failed with status ${res.status}:`, res.body);
    }
  };

  return (
    <Container>
      <Header>Hello {participant ?? '???'}</Header>
      <Modal
        trigger={<Button onClick={() => setEditingProposal(true)}>Propose Todo</Button>}
        open={editingProposal}
        onClose={() => setEditingProposal(false)}
      >
        <Modal.Header>Propose a new todo item</Modal.Header>
        <Modal.Content>
          <Form onSubmit={handleSubmitProposal}>
            <Form.Field>
              <label>Description</label>
              <input
                placeholder='Description'
                value={description}
                onChange={event => setDescription(event.currentTarget.value)}
              />
            </Form.Field>
            <Form.Field>
              <label>Assignee</label>
              <input
                placeholder='Assignee'
                value={assignee}
                onChange={event => setAssignee(event.currentTarget.value)}
              />
            </Form.Field>
            <Form.Field>
              <label>Reviewers (separate multiple by commas)</label>
              <input
                placeholder='Reviewers'
                value={reviewers}
                onChange={event => setReviewers(event.currentTarget.value)}
              />
            </Form.Field>
            <Button type="submit">Submit</Button>
            <Button type="button" onClick={() => setEditingProposal(false)}>Cancel</Button>
          </Form>
        </Modal.Content>
      </Modal>
      <Grid columns="5">
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
