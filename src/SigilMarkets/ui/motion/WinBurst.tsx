import { motion } from 'framer-motion';

export const WinBurst = () => {
  return (
    <motion.div
      className="sm-win-burst"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.8 }}
    />
  );
};
