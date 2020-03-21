import React from 'react';
import { Grid, Header, Card, Button, List, SemanticICONS } from 'semantic-ui-react';
import { Id, ContractState, Contract, PartyId, UpdateMessage } from 'qanban-types';
import ProposalButton from './ProposalButton';

type Props = {
  participant: PartyId;
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
  isActive(participant: PartyId, contract: Contract): boolean;
  callback(id: Id, reload: () => void): void;
}

function simpleCallback(type: Exclude<UpdateMessage["type"], "reject">): (id: Id, reload: () => void) => void {
  const callback = async (id: Id, reload: () => void) => {
    const command: UpdateMessage = {id, type};
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
    const command: UpdateMessage = {id, type: "reject", comment};
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
    label: "Accept",
    isActive: (participant, contract) => contract.missingApprovals.includes(participant),
    callback: simpleCallback("approve"),
  }],
  "DONE": [],
};

const ICONS: Record<ContractState, (party: PartyId, contract: Contract) => SemanticICONS> = {
  "PROPOSED": (party, contract) =>
    contract.missingAcceptances.includes(party) ? "question circle outline" : "check circle outline",
  "ACCEPTED": (party, contract) =>
    party === contract.assignee ? "play circle outline" : "circle outline",
  "IN_PROGRESS": (party, contract) =>
    party === contract.assignee ? "stop circle outline" : "circle outline",
  "IN_REVIEW": (party, contract) =>
    contract.missingApprovals.includes(party) ? "question circle outline" : "check circle outline",
  "DONE": () => "check circle outline",
};

const Column: React.FC<Props> = props => {
  const contracts = props.contracts.filter(contract => contract.contract.state === props.state);
  return (
    <Grid.Column>
      <Header textAlign="center">{TITLES[props.state]}</Header>
      {props.state !== "PROPOSED" ? null : <ProposalButton reload={props.reload} />}
      {contracts.map(({id, contract}) => {
        const actions = ACTIONS[props.state].filter(action =>
          props.participant !== undefined && action.isActive && action.isActive(props.participant, contract));
        const icon = (party: PartyId) => ICONS[contract.state](party, contract);

        return (
          <Card key={id}>
            <Card.Content>
              <Card.Header>{contract.description}</Card.Header>
            </Card.Content>
            <Card.Content>
              <List>
                <List.Item icon={icon(contract.proposer)} content={`${contract.proposer} (proposer)`} />
                <List.Item icon={icon(contract.assignee)} content={`${contract.assignee} (assignee)`} />
                {contract.reviewers.map(reviewer => (
                  <List.Item key={reviewer} icon={icon(reviewer)} content={`${reviewer} (reviewer)`} />
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
            {actions.length === 0 ? null :
              <Button.Group attached="bottom" size="small">
                {actions.map(action => (
                  <Button
                    key={action.label}
                    onClick={() => action.callback(id, props.reload)}
                    content={action.label}
                  />
                ))}
              </Button.Group>}
          </Card>
        );
      })}
    </Grid.Column>
  );
}

export default Column;
