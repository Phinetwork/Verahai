import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'ghost' | 'glass';
}

export const Button = ({ tone = 'primary', className, ...props }: ButtonProps) => {
  return (
    <button className={clsx('sm-button', `sm-button--${tone}`, className)} {...props} />
  );
};
