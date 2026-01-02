import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

export const Sheet = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return <div className={clsx('sm-sheet', className)} {...props} />;
};
