export const launchConfetti = () => {
  document.body.classList.add('confetti');
  window.setTimeout(() => document.body.classList.remove('confetti'), 1200);
};
