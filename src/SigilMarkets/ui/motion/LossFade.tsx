import { motion } from 'framer-motion';

export const LossFade = () => {
  return (
    <motion.div
      className="sm-loss-fade"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
    />
  );
};
