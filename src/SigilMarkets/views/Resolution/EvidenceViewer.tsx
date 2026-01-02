import { Card } from '../../ui/atoms/Card';

export const EvidenceViewer = () => {
  return (
    <Card className="sm-resolution__evidence">
      <h4>Evidence ledger</h4>
      <ul>
        <li>Oracle consensus report · 2h ago</li>
        <li>Market snapshots · 4h ago</li>
        <li>Sigil proofs · 6h ago</li>
      </ul>
    </Card>
  );
};
