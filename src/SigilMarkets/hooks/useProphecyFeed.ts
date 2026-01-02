import { useFeedStore } from '../state/feedStore';

export const useProphecyFeed = () => {
  return useFeedStore((state) => state.signals);
};
