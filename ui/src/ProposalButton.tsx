import React, { useState } from 'react';
import { Button, Modal, Form } from 'semantic-ui-react';
import { CreateCommand, createCommandDecoder } from 'qanban-types';

type Props = {
  reload: () => void;
}

const ProposalButton: React.FC<Props> = ({reload}) => {
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
    <Modal
      trigger={<Button fluid onClick={() => setEditingProposal(true)}>Propose Todo</Button>}
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
  );
}

export default ProposalButton;
