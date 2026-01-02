import { motion } from 'framer-motion';

export const BreathGlow = () => {
  return (
    <motion.div
      className="sm-breath-glow"
      animate={{ opacity: [0.4, 0.9, 0.4], scale: [1, 1.1, 1] }}
      transition={{ duration: 6, repeat: Infinity }}
    />
  );
};
