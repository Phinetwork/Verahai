import { motion } from 'framer-motion';

export const PulseSpark = () => {
  return (
    <motion.span
      className="sm-pulse-spark"
      animate={{ opacity: [0.2, 1, 0.2], scale: [0.9, 1.1, 0.9] }}
      transition={{ duration: 2.2, repeat: Infinity }}
    />
  );
};
