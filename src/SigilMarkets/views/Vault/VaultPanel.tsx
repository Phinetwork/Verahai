import { VaultSigilCard } from './VaultSigilCard';
import { VaultBalance } from './VaultBalance';
import { VaultLocks } from './VaultLocks';
import { VaultGrowthLine } from './VaultGrowthLine';
import { VaultStreak } from './VaultStreak';
import { VaultActions } from './VaultActions';
import { DepositWithdrawSheet } from './DepositWithdrawSheet';
import { useState } from 'react';

export const VaultPanel = () => {
  const [showSheet, setShowSheet] = useState(false);

  return (
    <section className="sm-vault">
      <VaultSigilCard />
      <VaultBalance />
      <VaultGrowthLine />
      <div className="sm-vault__row">
        <VaultLocks />
        <VaultStreak />
      </div>
      <VaultActions onOpen={() => setShowSheet(true)} />
      {showSheet && <DepositWithdrawSheet onClose={() => setShowSheet(false)} />}
    </section>
  );
};
