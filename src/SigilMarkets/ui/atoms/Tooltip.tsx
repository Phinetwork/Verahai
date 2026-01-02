import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

export const Tooltip = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => {
  return <span className={clsx('sm-tooltip', className)} {...props} />;
};
