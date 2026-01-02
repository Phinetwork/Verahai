import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export const KaiReveal = ({ children }: { children: ReactNode }) => {
  return (
    <motion.div
      className="sm-kai-reveal"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      {children}
    </motion.div>
  );
};
