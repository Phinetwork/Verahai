import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'default' | 'success' | 'warning';
}

export const Chip = ({ tone = 'default', className, ...props }: ChipProps) => {
  return <span className={clsx('sm-chip', `sm-chip--${tone}`, className)} {...props} />;
};
