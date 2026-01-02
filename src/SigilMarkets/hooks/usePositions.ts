import { usePositionStore } from '../state/positionStore';

export const usePositions = () => {
  return usePositionStore((state) => state.positions);
};
