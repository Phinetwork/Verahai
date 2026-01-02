import { ResolutionSigilCard } from './ResolutionSigilCard';
import { OutcomeReveal } from './OutcomeReveal';
import { DisputeSheet } from './DisputeSheet';
import { EvidenceViewer } from './EvidenceViewer';
import { useState } from 'react';

export const ResolutionCenter = () => {
  const [disputeOpen, setDisputeOpen] = useState(false);

  return (
    <section className="sm-resolution">
      <ResolutionSigilCard />
      <OutcomeReveal />
      <EvidenceViewer />
      <button className="sm-link" onClick={() => setDisputeOpen(true)}>
        File dispute
      </button>
      {disputeOpen && <DisputeSheet onClose={() => setDisputeOpen(false)} />}
    </section>
  );
};
