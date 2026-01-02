import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

export const Icon = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => {
  return <span className={clsx('sm-icon', className)} {...props} />;
};
