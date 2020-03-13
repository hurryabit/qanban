import React from 'react';
import { Grid, Header, Card, Button, List, SemanticICONS } from 'semantic-ui-react';
import { Id, ContractState, Contract, Party, UpdateCommand } from 'qanban-types';

type Props = {
  participant: Party | undefined;
  state: ContractState;
  contracts: { id: Id; contract: Contract }[];
  reload: () => void;
}

const TITLES: Record<ContractState, string> = {
  "PROPOSED": 'Proposed',
  "ACCEPTED": 'Accepted',
  "IN_PROGRESS": 'In Progress',
  "IN_REVIEW": 'In Review',
  "DONE": 'Done',
};

type Action = {
  label: string;
  isActive(participant: Party, contract: Contract): boolean;
  callback(id: Id, reload: () => void): void;
}

function simpleCallback(type: Exclude<UpdateCommand["type"], "reject">): (id: Id, reload: () => void) => void {
  const callback = async (id: Id, reload: () => void) => {
    const command: UpdateCommand = {id, type};
    const res = await fetch('/api/command', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (res.ok) {
      reload();
    } else {
      console.error(`command failed with status ${res.status}:`, res.body);
    }
  }
  return callback;
}

function rejectCallback(): (id: Id, reload: () => void) => void {
  const callback = async (id: Id, reload: () => void) => {
    const comment = prompt('Please add an explanatory comment.');
    if (comment === null) {
      return;
    }
    const command: UpdateCommand = {id, type: "reject", comment};
    const res = await fetch('/api/command', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (res.ok) {
      reload();
    } else {
      console.error(`command failed with status ${res.status}:`, res.body);
    }
  }
  return callback;
}

const ACTIONS: Record<ContractState, Action[]> = {
  "PROPOSED": [{
    label: "Accept",
    isActive: (participant, contract) => contract.missingAcceptances.includes(participant),
    callback: simpleCallback("accept"),
  }],
  "ACCEPTED": [{
    label: "Start",
    isActive: (participant, contract) => participant === contract.assignee,
    callback: simpleCallback("start"),
  }],
  "IN_PROGRESS": [{
    label: "Finish",
    isActive: (participant, contract) => participant === contract.assignee,
    callback: simpleCallback("finish"),
  }],
  "IN_REVIEW": [{
    label: "Reject",
    isActive: (participant, contract) => contract.missingApprovals.includes(participant),
    callback: rejectCallback(),
  }, {
    label: "Approve",
    isActive: (participant, contract) => contract.missingApprovals.includes(participant),
    callback: simpleCallback("approve"),
  }],
  "DONE": [],
}

const Column: React.FC<Props> = props => {
  const contracts = props.contracts.filter(contract => contract.contract.state === props.state);
  return (
    <Grid.Column>
      <Header textAlign="center">{TITLES[props.state]}</Header>
      {contracts.map(({id, contract}) => {

        let icon: (party: Party) => SemanticICONS = () => "circle outline";
        switch (props.state) {
          case "PROPOSED": {
            const missingAcceptances = new Set<Party>(contract.missingAcceptances);
            icon = (party: Party) => missingAcceptances.has(party) ? "question circle outline" : "check circle outline";
            break;
          }
          case "IN_REVIEW": {
            const missingApprovals = new Set<Party>(contract.missingApprovals);
            icon = (party: Party) => missingApprovals.has(party) ? "question circle outline" : "check circle outline";
            break;
          }
        }
        const actions = ACTIONS[props.state].filter(action =>
          props.participant !== undefined && action.isActive && action.isActive(props.participant, contract));

        return (
          <Card key={id}>
            <Card.Content>
              <Card.Header>{contract.description}</Card.Header>
            </Card.Content>
            <Card.Content>
              <List>
                <List.Item icon={icon(contract.proposer)} content={`proposer: ${contract.proposer}`} />
                <List.Item icon={icon(contract.assignee)} content={`assignee: ${contract.assignee}`} />
                {contract.reviewers.map(reviewer => (
                  <List.Item key={reviewer} icon={icon(reviewer)} content={`reviewer: ${reviewer}`} />
                ))}
              </List>
            </Card.Content>
            {contract.comments.length === 0 ? null : <Card.Content>
              <List>
                {contract.comments.map((comment, index) =>
                  <List.Item key={index} icon="comment outline" content={comment} />
                )}
              </List>
            </Card.Content>}
            {actions.length === 0 ? null : <Card.Content extra>
              <Button.Group fluid>
                {actions.map(action => (
                  <Button
                    key={action.label}
                    onClick={() => action.callback(id, props.reload)}
                    content={action.label}
                  />
                ))}
              </Button.Group>
            </Card.Content>}
          </Card>
        );
      })}
    </Grid.Column>
  );
}

export default Column;
